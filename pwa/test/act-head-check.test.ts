// The console's check of the act journal's signed head (Overlord W2, act journal plan Task A3): `checkActHead` over fake ports, the
// real WebCrypto Ed25519 check over a signature Node made, the kept head in storage that throws, and the digest's line.
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { actHeadPreimage, type ActHeadReadWire, type HeadPosition } from '../../shared/actJournalHead';
import { checkActHead, type ActHeadPorts } from '../src/overlord/actHeadCheck';
import { actHeadDigestLine } from '../src/overlord/actHeadWords';
import { ACT_HEAD_KEPT_KEY, localKept, webCryptoEd25519 } from '../src/overlord/useActHead';

const D = (c: string): string => c.repeat(64);
const pair = generateKeyPairSync('ed25519');
const PEM = pair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const HEAD = { day: '2026-11-28', sequence: 12, journalId: D('a'), digest: D('b') };
const SIG = sign(null, Buffer.from(actHeadPreimage(HEAD)!, 'utf8'), pair.privateKey).toString('base64');

function ports(o: { wire?: ActHeadReadWire | null | 'throw'; kept?: HeadPosition | null | 'throw'; verify?: boolean | 'cannot-verify-here' | 'throw' } = {}) {
  const sets: HeadPosition[] = [];
  const asked: (number | null)[] = [];
  const p: ActHeadPorts = {
    read: async (at) => { asked.push(at); if (o.wire === 'throw') throw new Error('down'); return o.wire === undefined ? { v: 1, head: { ...HEAD, signature: SIG, unsigned: null }, publicKeyPem: PEM, at: null } : o.wire; },
    kept: {
      get: () => { if (o.kept === 'throw') throw new Error('blocked'); return o.kept ?? null; },
      set: (x) => { if (o.kept === 'throw') throw new Error('blocked'); sets.push(x); },
    },
    verify: async () => { if (o.verify === 'throw') throw new Error('no'); return o.verify ?? true; },
  };
  return { p, sets, asked };
}

describe('checkActHead', () => {
  it('no head yet is none; a failed or thrown read is unmeasured, never a value', async () => {
    expect(await checkActHead(ports({ wire: { v: 1, head: 'absent', publicKeyPem: null, at: null } }).p)).toEqual({ kind: 'none' });
    expect(await checkActHead(ports({ wire: null }).p)).toEqual({ kind: 'unmeasured' });
    expect(await checkActHead(ports({ wire: 'throw' }).p)).toEqual({ kind: 'unmeasured' });
  });

  it('nothing kept: the first verified head is kept, and asked for with no at', async () => {
    const r = ports();
    expect(await checkActHead(r.p)).toEqual({ kind: 'read', sequence: 12, unsigned: null, verify: 'verified', extendsKept: 'first', keptSequence: null });
    expect(r.asked).toEqual([null]);
    expect(r.sets).toEqual([{ sequence: 12, digest: D('b') }]);
  });

  it('a kept head is asked for by its sequence, and a newer head that extends it is kept in its place', async () => {
    const r = ports({ kept: { sequence: 5, digest: D('c') }, wire: { v: 1, head: { ...HEAD, signature: SIG, unsigned: null }, publicKeyPem: PEM, at: { sequence: 5, digest: D('c') } } });
    expect(await checkActHead(r.p)).toMatchObject({ verify: 'verified', extendsKept: 'extends', keptSequence: 5 });
    expect(r.asked).toEqual([5]);
    expect(r.sets).toEqual([{ sequence: 12, digest: D('b') }]);
  });

  it('a head that does not extend the kept one keeps nothing, and names the kept record', async () => {
    const r = ports({ kept: { sequence: 5, digest: D('c') }, wire: { v: 1, head: { ...HEAD, signature: SIG, unsigned: null }, publicKeyPem: PEM, at: { sequence: 5, digest: D('d') } } });
    expect(await checkActHead(r.p)).toMatchObject({ extendsKept: 'does-not-extend', keptSequence: 5 });
    expect(r.sets).toEqual([]);
  });

  it('a read that skipped the kept sequence is unmeasured for the extends check, never a pass', async () => {
    const r = ports({ kept: { sequence: 5, digest: D('c') } });
    expect(await checkActHead(r.p)).toMatchObject({ extendsKept: 'unmeasured' });
    expect(r.sets).toEqual([]);
  });

  it('a signature that does not verify keeps nothing; a browser without Ed25519 says so and keeps nothing', async () => {
    for (const verify of [false, 'cannot-verify-here', 'throw'] as const) {
      const r = ports({ verify });
      expect((await checkActHead(r.p)) as { verify: string }, String(verify)).toMatchObject({ verify: verify === false ? 'failed' : 'cannot-verify-here' });
      expect(r.sets).toEqual([]);
    }
  });

  it('an unsigned head is not-signed, is never verified and is never kept', async () => {
    const r = ports({ wire: { v: 1, head: { ...HEAD, signature: null, unsigned: 'shared-user' }, publicKeyPem: PEM, at: null } });
    expect(await checkActHead(r.p)).toMatchObject({ unsigned: 'shared-user', verify: 'not-signed' });
    expect(r.sets).toEqual([]);
  });

  it('a signed head with no public key fails the check', async () => {
    expect(await checkActHead(ports({ wire: { v: 1, head: { ...HEAD, signature: SIG, unsigned: null }, publicKeyPem: null, at: null } }).p)).toMatchObject({ verify: 'failed' });
  });

  it('storage that throws reads as nothing kept, keeps nothing, and the check still answers', async () => {
    expect(await checkActHead(ports({ kept: 'throw' }).p)).toMatchObject({ kind: 'read', extendsKept: 'first', verify: 'verified' });
  });
});

describe('the real ports', () => {
  it('WebCrypto verifies Node\'s Ed25519 signature over the preimage, and refuses another head\'s', async () => {
    expect(await webCryptoEd25519(PEM, actHeadPreimage(HEAD)!, SIG)).toBe(true);
    expect(await webCryptoEd25519(PEM, actHeadPreimage({ ...HEAD, sequence: 13 })!, SIG)).toBe(false);
    expect(await webCryptoEd25519('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----', actHeadPreimage(HEAD)!, SIG)).toBe('cannot-verify-here');
  });

  it('the kept head round-trips through localStorage under its key, and a malformed entry reads as nothing kept', async () => {
    localStorage.clear();
    localKept.set({ sequence: 3, digest: D('e') });
    expect(JSON.parse(localStorage.getItem(ACT_HEAD_KEPT_KEY)!)).toEqual({ sequence: 3, digest: D('e') });
    expect(localKept.get()).toEqual({ sequence: 3, digest: D('e') });
    localStorage.setItem(ACT_HEAD_KEPT_KEY, '{nope');
    expect(localKept.get()).toBeNull();
    localStorage.setItem(ACT_HEAD_KEPT_KEY, JSON.stringify({ sequence: 0, digest: 'x' }));
    const r = ports();
    expect(await checkActHead({ ...r.p, kept: localKept })).toMatchObject({ extendsKept: 'first' });
    localStorage.clear();
  });
});

describe('the digest\'s line', () => {
  it('signed, unsigned with its word, a failed read, and nothing for no field or one out of shape', () => {
    expect(actHeadDigestLine({ ...HEAD, sequence: 1234, signature: SIG, unsigned: null })).toBe('Overlord act journal: record 1,234, signed');
    expect(actHeadDigestLine({ ...HEAD, signature: null, unsigned: 'shared-user' })).toBe('Overlord act journal: record 12, unsigned (shared-user)');
    expect(actHeadDigestLine('unmeasured')).toBe('Overlord act journal: its head could not be read');
    expect([actHeadDigestLine(undefined), actHeadDigestLine({ ...HEAD, signature: SIG, unsigned: 'x' }), actHeadDigestLine({ day: 'x' })]).toEqual([null, null, null]);
  });
});
