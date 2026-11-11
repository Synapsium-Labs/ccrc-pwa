// D-8337 (plan docs/superpowers/plans/2026-11-11-test-box-key-rotate-revoke.md): `ccrc testbox-admin key-rotate | key-revoke`.
//
// What is held here: that key-rotate puts the new key's line on the box with the OLD key, logs in with the NEW key alone, and only
// then switches the stored pair and removes the old line with the new key; that a box which does not take the new key leaves the
// old key in place, working, and its own line as it was; that an unreachable box or a refused precondition changes nothing; that a
// failed removal of the old line still switches and answers `old-line-kept` with the old key's public words; that key-revoke takes
// the pairing apart as Disconnect does and deletes the key pair, answering the revoked key's public words when the box side was
// not done; and that no private key material is ever in an answer, the log, the state file or the box's authorized_keys.
//
// The fake box (fixtures/testbox-admin-akbox.sh) keeps a real authorized_keys file and lets a key in only when it is listed there,
// the way sshd does; the real `ssh-keygen` makes and reads every key. HOME is a fixture; ghContainedEnv poisons the user manager
// and tmux. Every row runs a fixed bash program; values are its arguments. No network is reached.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { readTestboxAdminStatus } from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-akbox.sh');
const SCANFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_KEYGEN = spawnSync('bash', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;
const ADDR = '10.0.0.9';
const SRC_ADDR = '192.0.2.5';
const SRC = '. "$1" || exit 90; shift; CCD_OS=linux; ';
const OTHER_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherPersonsKeyOtherPersonsKeyOtherPerso person@laptop';

interface Home {
  home: string; env: NodeJS.ProcessEnv; log: string; state: string; key: string; pin: string; ak: string; trust: string; lg: string;
}

function fixture(): Home {
  const home = mkTmp('tb-rotate-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  const boxBin = join(home, 'box-bin');
  mkdirSync(fakes, { recursive: true });
  mkdirSync(boxBin, { recursive: true });
  symlinkSync(BOXFAKE, join(fakes, 'ssh'));
  symlinkSync(BOXFAKE, join(fakes, 'ip'));
  symlinkSync(SCANFAKE, join(fakes, 'ssh-keyscan'));
  symlinkSync(BOXFAKE, join(boxBin, 'getent'));
  symlinkSync(BOXFAKE, join(boxBin, 'sudo'));
  const boxHome = join(home, 'box');
  mkdirSync(join(boxHome, '.ssh'), { recursive: true });
  const ak = join(boxHome, '.ssh', 'authorized_keys');
  writeFileSync(ak, `${OTHER_LINE}\n`, { mode: 0o600 });
  const ccd = join(home, 'ccd-fake');
  writeFileSync(ccd, '#!/bin/sh\n{ printf -- \'-- ccd\\n\'; for a in "$@"; do printf \'%s\\n\' "$a"; done; } >> "${FAKE_LOG:-/dev/null}"\nexit 0\n', { mode: 0o755 });
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_') && !k.startsWith('TBA_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    FAKE_LOG: join(home, 'fake-log'), FAKE_IP_OUT: `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`, FAKE_BOX_HOME: boxHome, FAKE_BOX_BIN: boxBin,
    TBA_CCD: ccd,
  });
  return {
    home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), ak, trust: join(home, 'trust'),
    state: join(home, '.ccrc', 'testbox-admin.state'), key: join(home, '.ccrc', 'testbox-admin.key'), pin: join(home, '.ccrc', 'testbox-known-hosts'),
    lg: join(home, '.ccrc', 'testbox-admin.log'),
  };
}

function sh(h: Home, program: string, args: string[] = []): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', program, '_', ...args], { env: h.env, encoding: 'utf8', cwd: h.home });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
function verb(h: Home, ...args: string[]): { out: string; err: string; rc: number } {
  return sh(h, SRC + '_tba_main "$@"', [VERB, ...args]);
}
function json(r: { out: string; err: string }): Record<string, unknown> {
  expect(r.out.trim().split('\n'), r.out + r.err).toHaveLength(1);
  return JSON.parse(r.out) as Record<string, unknown>;
}
/** The fake's log as calls: the tool, its arguments, and (for an ssh the box let in) the `as <key>` line last. */
function calls(h: Home): string[][] {
  if (!existsSync(h.log)) return [];
  const out: string[][] = [];
  for (const l of readFileSync(h.log, 'utf8').split('\n')) {
    if (l.startsWith('-- ')) out.push([l.slice(3)]);
    else if (l !== '' && out.length > 0) out[out.length - 1]!.push(l);
  }
  return out;
}
const sshCalls = (h: Home): string[][] => calls(h).filter((c) => c[0] === 'ssh');
/** Which key each ssh call was let in with (null: refused or not answered). */
const asKeys = (h: Home): (string | null)[] => sshCalls(h).map((c) => {
  const last = c[c.length - 1]!;
  return last.startsWith('as ') ? last.slice(3) : null;
});
/** The `-i` file each ssh call offered. */
const identities = (h: Home): string[] => sshCalls(h).map((c) => c[c.indexOf('-i') + 1]!);
const pubB64 = (file: string): string => readFileSync(file, 'utf8').trim().split(' ')[1]!;
const akLines = (h: Home): string[] => readFileSync(h.ak, 'utf8').split('\n').filter((l) => l !== '');
const ccrcLines = (h: Home): string[] => akLines(h).filter((l) => l.endsWith(' ccrc-testbox-admin'));

/** A real ed25519 host key the fake ssh-keyscan presents, pinned. */
function pinHostKey(h: Home): void {
  const f = join(h.home, 'hostkey');
  expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'host', '-f', f]).status).toBe(0);
  const [type, b64] = readFileSync(`${f}.pub`, 'utf8').trim().split(' ') as [string, string];
  writeFileSync(h.pin, `${ADDR} ${type} ${b64}\n`, { mode: 0o600 });
  h.env['FAKE_SSH_KEYSCAN_OUT'] = `${ADDR} ${type} ${b64}`;
  h.env['FAKE_SSH_KEYSCAN_RC'] = '0';
}
/** The state a Connect leaves: the key made, its line on the box, the host key pinned, connected. */
function connected(h: Home, login = 'root'): string {
  const r = verb(h, 'key', `--address=${ADDR}`, `--login=${login}`);
  const a = json(r);
  expect(a['ok'], r.out + r.err).toBe(true);
  writeFileSync(h.ak, `${OTHER_LINE}\n${String(a['line'])}\n`, { mode: 0o600 });
  pinHostKey(h);
  writeFileSync(h.state, `${readFileSync(h.state, 'utf8')}connected=1\n`, { mode: 0o600 });
  writeFileSync(h.log, '');
  return String(a['line']);
}
/** Every line of the private key's body, for the "never printed" checks. */
const privateBody = (file: string): string[] => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('-----'));

function neverLeaks(h: Home, priv: string[], ...texts: string[]): void {
  expect(priv.length).toBeGreaterThan(0);
  const places = [...texts, readFileSync(h.state, 'utf8'), existsSync(h.lg) ? readFileSync(h.lg, 'utf8') : '', readFileSync(h.ak, 'utf8'),
    existsSync(h.log) ? readFileSync(h.log, 'utf8') : ''];
  for (const l of priv) for (const p of places) expect(p).not.toContain(l);
  for (const p of places) expect(p).not.toContain('PRIVATE KEY');
}
const tempDirs = (h: Home): string[] => readdirSync(join(h.home, '.ccrc')).filter((n) => n.startsWith('key.') || n.includes('.tmp.'));

describe.skipIf(!HAS_KEYGEN)('ccrc testbox-admin key-rotate (D-8337)', () => {
  it('rotate appends the new line with the old key, logs in with the new key alone, switches, then removes the old line with the new key', () => {
    const h = fixture();
    const oldLine = connected(h);
    const oldB64 = pubB64(`${h.key}.pub`);
    const oldPriv = privateBody(h.key);
    const r = verb(h, 'key-rotate', '--from', 'pwa');
    const a = json(r);
    expect(a['ok'], r.out + r.err).toBe(true);
    const newB64 = pubB64(`${h.key}.pub`);
    expect(newB64).not.toBe(oldB64);
    // the answer is the new PUBLIC line, with the same from= rule as `key`
    expect(a['line']).toBe(`from="${SRC_ADDR}",restrict ssh-ed25519 ${newB64} ccrc-testbox-admin`);
    expect(a['line']).not.toBe(oldLine);
    // the stored pair is the new one, a pair, 0600, with ccrc's comment
    const derived = spawnSync('ssh-keygen', ['-y', '-f', h.key], { encoding: 'utf8' }).stdout.trim().split(' ');
    expect(derived[1]).toBe(newB64);
    expect(statSync(h.key).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${h.key}.pub`, 'utf8').trim().endsWith(' ccrc-testbox-admin')).toBe(true);
    // three box calls: the append as the old key, the login as the new key, the removal as the new key
    expect(asKeys(h)).toEqual([oldB64, newB64, newB64]);
    expect(identities(h)[0]).toBe(h.key);
    expect(identities(h)[2]).toBe(h.key);
    expect(identities(h)[1]).not.toBe(h.key);
    // the box holds the new line once, not the old, and the operator's other line as it was
    expect(ccrcLines(h)).toEqual([String(a['line'])]);
    expect(akLines(h)).toContain(OTHER_LINE);
    // nothing is left behind, and no private half is anywhere
    expect(tempDirs(h)).toEqual([]);
    neverLeaks(h, oldPriv, r.out, r.err);
    neverLeaks(h, privateBody(h.key), r.out, r.err);
    // the connection and the pin are as they were
    const s = readTestboxAdminStatus(sh(h, `bash "$1" status`, [VERB]).out.trim());
    expect(s.ok && s.value).toMatchObject({ connected: true, addressSet: true, hostKey: 'pinned' });
    expect(readFileSync(h.lg, 'utf8')).toContain('key-rotate: the access key was rotated');
  });

  it('a sudo login runs every box command under sudo -n, the new key\'s login included', () => {
    const h = fixture();
    connected(h, 'deploy');
    expect(json(verb(h, 'key-rotate'))['ok']).toBe(true);
    const cmds = sshCalls(h).map((c) => c.filter((l) => !l.startsWith('as ')).slice(-1)[0]!);
    expect(cmds).toHaveLength(3);
    for (const c of cmds) expect(c.startsWith('sudo -n -- ')).toBe(true);
    expect(cmds[1]).toBe('sudo -n -- true');
    expect(sshCalls(h).every((c) => c.includes('deploy@10.0.0.9'))).toBe(true);
  });

  it('a box that does not take the new key keeps the old key in place and working, and its own line as it was', () => {
    const h = fixture();
    connected(h);
    const oldB64 = pubB64(`${h.key}.pub`);
    const before = readFileSync(h.key);
    const akBefore = readFileSync(h.ak, 'utf8');
    // the box's sshd lets in only the old key (a from= the new line does not match, a key type it refuses)
    writeFileSync(h.trust, `${oldB64}\n`);
    h.env['FAKE_BOX_TRUST'] = h.trust;
    const r = verb(h, 'key-rotate');
    expect(json(r)).toEqual({ ok: false, code: 'new-key-refused' });
    // append (old), the new login refused, the new line taken out again (old)
    expect(asKeys(h)).toEqual([oldB64, null, oldB64]);
    expect(readFileSync(h.key).equals(before)).toBe(true);
    expect(pubB64(`${h.key}.pub`)).toBe(oldB64);
    expect(readFileSync(h.ak, 'utf8')).toBe(akBefore);
    expect(tempDirs(h)).toEqual([]);
    // the old key still logs in: the next rotate, once the box takes new keys, goes through with it
    delete h.env['FAKE_BOX_TRUST'];
    writeFileSync(h.log, '');
    expect(json(verb(h, 'key-rotate'))['ok']).toBe(true);
    expect(asKeys(h)[0]).toBe(oldB64);
  });

  it('an append the box refuses changes nothing and answers new-key-refused', () => {
    const h = fixture();
    connected(h);
    const before = readFileSync(h.key);
    const akBefore = readFileSync(h.ak, 'utf8');
    h.env['FAKE_BOX_FAIL_RE'] = 'ccrc-ak-add';
    expect(json(verb(h, 'key-rotate'))).toEqual({ ok: false, code: 'new-key-refused' });
    expect(sshCalls(h)).toHaveLength(1);
    expect(readFileSync(h.key).equals(before)).toBe(true);
    expect(readFileSync(h.ak, 'utf8')).toBe(akBefore);
    expect(tempDirs(h)).toEqual([]);
  });

  it('a box that does not answer changes nothing and answers unreachable; one that refuses the old key answers auth-refused', () => {
    const h = fixture();
    connected(h);
    const before = readFileSync(h.key);
    h.env['FAKE_BOX_DOWN_FROM'] = '1';
    expect(json(verb(h, 'key-rotate'))).toEqual({ ok: false, code: 'unreachable' });
    expect(readFileSync(h.key).equals(before)).toBe(true);
    expect(tempDirs(h)).toEqual([]);
    delete h.env['FAKE_BOX_DOWN_FROM'];
    writeFileSync(h.ak, `${OTHER_LINE}\n`);
    expect(json(verb(h, 'key-rotate'))).toEqual({ ok: false, code: 'auth-refused' });
    expect(readFileSync(h.key).equals(before)).toBe(true);
    expect(readFileSync(h.ak, 'utf8')).toBe(`${OTHER_LINE}\n`);
  });

  it('an old line that cannot be removed still switches to the new key, and answers old-line-kept with the old key\'s public words', () => {
    const h = fixture();
    connected(h);
    const oldB64 = pubB64(`${h.key}.pub`);
    // the box stops answering at the third call: the removal of the old line
    h.env['FAKE_BOX_DOWN_FROM'] = '3';
    const r = verb(h, 'key-rotate');
    expect(json(r)).toEqual({ ok: false, code: 'old-line-kept', line: `ssh-ed25519 ${oldB64} ccrc-testbox-admin` });
    expect(pubB64(`${h.key}.pub`)).not.toBe(oldB64);
    expect(ccrcLines(h)).toHaveLength(2);
    expect(tempDirs(h)).toEqual([]);
  });

  it('the removal takes out every line of ccrc\'s that is not the new key (one an interrupted rotate left too) and no other line', () => {
    const h = fixture();
    connected(h);
    const stale = join(h.home, 'stale');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ccrc-testbox-admin', '-f', stale]).status).toBe(0);
    const staleLine = `from="${SRC_ADDR}",restrict ${readFileSync(`${stale}.pub`, 'utf8').trim()}`;
    const ownsLike = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINotCcrcsNotCcrcsNotCcrcsNotCcrcsNotCcrcsNo ccrc-testbox-admin-not';
    writeFileSync(h.ak, `${readFileSync(h.ak, 'utf8')}${staleLine}\n${ownsLike}`);   // the last line with no newline at its end
    const a = json(verb(h, 'key-rotate'));
    expect(a['ok']).toBe(true);
    expect(ccrcLines(h)).toEqual([String(a['line'])]);
    expect(akLines(h)).toContain(OTHER_LINE);
    expect(akLines(h)).toContain(ownsLike);
  });

  it('refuses with nothing touched: no connection, no key, a key ccrc did not make, no pin, a changed host key', () => {
    const none = fixture();
    expect(json(verb(none, 'key-rotate'))).toEqual({ ok: false, code: 'not-connected' });
    expect(sshCalls(none)).toEqual([]);

    const nokey = fixture();
    writeFileSync(nokey.state, `address=${ADDR}\nport=22\nlogin=root\n`, { mode: 0o600 });
    pinHostKey(nokey);
    expect(json(verb(nokey, 'key-rotate'))).toEqual({ ok: false, code: 'no-access-key' });
    expect(sshCalls(nokey)).toEqual([]);

    const foreign = fixture();
    connected(foreign);
    const other = join(foreign.home, 'other');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'someone-else', '-f', other]).status).toBe(0);
    writeFileSync(foreign.key, readFileSync(other), { mode: 0o600 });
    writeFileSync(`${foreign.key}.pub`, readFileSync(`${other}.pub`));
    expect(json(verb(foreign, 'key-rotate'))).toEqual({ ok: false, code: 'foreign-key' });
    expect(readFileSync(foreign.key).equals(readFileSync(other))).toBe(true);
    expect(sshCalls(foreign)).toEqual([]);

    const unpinned = fixture();
    connected(unpinned);
    writeFileSync(unpinned.pin, '');
    expect(json(verb(unpinned, 'key-rotate'))).toEqual({ ok: false, code: 'host-key-unknown' });
    expect(sshCalls(unpinned)).toEqual([]);

    const changed = fixture();
    connected(changed);
    const f = join(changed.home, 'hk2');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'host', '-f', f]).status).toBe(0);
    changed.env['FAKE_SSH_KEYSCAN_OUT'] = `${ADDR} ${readFileSync(`${f}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ')}`;
    const before = readFileSync(changed.key);
    expect(json(verb(changed, 'key-rotate'))).toEqual({ ok: false, code: 'host-key-changed' });
    expect(readFileSync(changed.key).equals(before)).toBe(true);
    expect(sshCalls(changed)).toEqual([]);
  });

  it('takes no field: any word is a usage error, and nothing runs', () => {
    const h = fixture();
    connected(h);
    const r = verb(h, 'key-rotate', `--address=${ADDR}`);
    expect(r.rc).toBe(2);
    expect(r.out).toBe('');
    expect(sshCalls(h)).toEqual([]);
  });
});

describe.skipIf(!HAS_KEYGEN)('ccrc testbox-admin key-revoke (D-8337)', () => {
  it('revoke takes the pairing apart as Disconnect does, removes ccrc\'s line from the box and deletes the key pair', () => {
    const h = fixture();
    connected(h);
    const priv = privateBody(h.key);
    const r = verb(h, 'key-revoke', '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    // the switch goes off first, as Disconnect's does
    expect(calls(h).find((c) => c[0] === 'ccd')).toEqual(['ccd', 'testbox-remote', '--state', 'off']);
    expect(ccrcLines(h)).toEqual([]);
    expect(akLines(h)).toEqual([OTHER_LINE]);
    expect(existsSync(h.key)).toBe(false);
    expect(existsSync(`${h.key}.pub`)).toBe(false);
    expect(existsSync(h.pin)).toBe(false);
    const s = readTestboxAdminStatus(sh(h, `bash "$1" status`, [VERB]).out.trim());
    expect(s.ok && s.value).toMatchObject({ connected: false, addressSet: false, hostKey: 'none' });
    neverLeaks(h, priv, r.out, r.err);
    expect(readFileSync(h.lg, 'utf8')).toContain('key-revoke: the access key was deleted');
    // the next `key` makes a new pair: the revoked line is never answered again
    const again = json(verb(h, 'key', `--address=${ADDR}`));
    expect(String(again['line'])).not.toContain(priv[0]!);
  });

  it('an unreachable box: the key is deleted and the box forgotten, and the answer names the line to remove by hand', () => {
    const h = fixture();
    connected(h);
    const b64 = pubB64(`${h.key}.pub`);
    h.env['FAKE_BOX_DOWN_FROM'] = '1';
    const r = verb(h, 'key-revoke');
    expect(json(r)).toEqual({ ok: false, code: 'revoked-box-skipped', line: `ssh-ed25519 ${b64} ccrc-testbox-admin` });
    expect(existsSync(h.key)).toBe(false);
    expect(existsSync(`${h.key}.pub`)).toBe(false);
    expect(ccrcLines(h)).toHaveLength(1);
    const s = readTestboxAdminStatus(sh(h, `bash "$1" status`, [VERB]).out.trim());
    expect(s.ok && s.value).toMatchObject({ connected: false, addressSet: false });
  });

  it('a key with no box recorded is deleted, and the answer names its line, since ccrc cannot tell where it was added', () => {
    const h = fixture();
    expect(json(verb(h, 'key', `--address=${ADDR}`))['ok']).toBe(true);
    const b64 = pubB64(`${h.key}.pub`);
    // the connection is taken apart (its box side skipped: no host key was pinned) and the pair kept, as Disconnect keeps it
    verb(h, 'disconnect');
    expect(existsSync(h.key)).toBe(true);
    writeFileSync(h.log, '');
    expect(json(verb(h, 'key-revoke'))).toEqual({ ok: false, code: 'revoked-box-skipped', line: `ssh-ed25519 ${b64} ccrc-testbox-admin` });
    expect(existsSync(h.key)).toBe(false);
    expect(sshCalls(h)).toEqual([]);
  });

  it('a box whose unpair does not finish: the key is still deleted, and the answer is revoked-unpair-failed with the line', () => {
    const h = fixture();
    connected(h);
    const b64 = pubB64(`${h.key}.pub`);
    h.env['FAKE_BOX_FAIL_RE'] = 'unpair';
    expect(json(verb(h, 'key-revoke'))).toEqual({ ok: false, code: 'revoked-unpair-failed', line: `ssh-ed25519 ${b64} ccrc-testbox-admin` });
    expect(existsSync(h.key)).toBe(false);
    // the line comes out whatever the unpair did, as Disconnect's does
    expect(ccrcLines(h)).toEqual([]);
  });

  it('refuses with nothing touched: no key, or a key ccrc did not make', () => {
    const h = fixture();
    expect(json(verb(h, 'key-revoke'))).toEqual({ ok: false, code: 'no-access-key' });
    expect(calls(h)).toEqual([]);
    const g = fixture();
    connected(g);
    const other = join(g.home, 'other');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'someone-else', '-f', other]).status).toBe(0);
    writeFileSync(g.key, readFileSync(other), { mode: 0o600 });
    writeFileSync(`${g.key}.pub`, readFileSync(`${other}.pub`));
    expect(json(verb(g, 'key-revoke'))).toEqual({ ok: false, code: 'foreign-key' });
    expect(existsSync(g.key)).toBe(true);
    expect(calls(g)).toEqual([]);
    expect(readFileSync(g.state, 'utf8')).toContain(`address=${ADDR}`);
  });
});
