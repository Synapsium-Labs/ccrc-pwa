// The act journal's signed head, bound to the console (Overlord W2, act journal plan Task A3): L4. It binds `checkActHead` (L1)'s
// three ports to the head read (`api.overlordActHead`), the head this device kept (the page's storage through `lib/storage.ts`, so a
// private window or blocked storage keeps nothing and the page still renders) and WebCrypto's Ed25519 (a browser without it reads
// `cannot-verify-here`). One check per mount of the Overlord place; it decides nothing.
import { useEffect, useState } from 'react';
import type { HeadPosition } from '../../../shared/actJournalHead';
import { api } from '../lib/api';
import { readKey, writeKey } from '../lib/storage';
import { checkActHead, type ActHeadPorts, type Ed25519Check } from './actHeadCheck';
import type { ActHeadView } from './actHeadWords';

/** The device's kept head: per viewer, a convenience the check can do without. */
export const ACT_HEAD_KEPT_KEY = 'ccrc.overlord.actHeadKept';

const pemToDer = (pem: string): ArrayBuffer => {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** WebCrypto's Ed25519 check of a base64 signature over the preimage's UTF-8 bytes. An import WebCrypto refuses (no Ed25519 in
 *  this browser) is `cannot-verify-here`; a signature that does not verify is `false`. */
export const webCryptoEd25519: Ed25519Check = async (publicKeyPem, preimage, signatureB64) => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return 'cannot-verify-here';
  let key: CryptoKey;
  try { key = await subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'Ed25519' }, false, ['verify']); } catch { return 'cannot-verify-here'; }
  return subtle.verify({ name: 'Ed25519' }, key, b64ToBytes(signatureB64), new TextEncoder().encode(preimage));
};

/** The kept head in the page's storage, through `lib/storage.ts` (its one owner): a store that throws or is absent reads as
 *  nothing kept and keeps nothing. */
export const localKept: ActHeadPorts['kept'] = {
  get: () => {
    const raw = readKey(ACT_HEAD_KEPT_KEY);
    if (raw === null) return null;
    try { return JSON.parse(raw) as HeadPosition; } catch { return null; }
  },
  set: (p) => { writeKey(ACT_HEAD_KEPT_KEY, JSON.stringify({ sequence: p.sequence, digest: p.digest })); },
};

/** The head read: an older server's 404 (`absent`) reads as no head yet, so it draws no line. */
const readHead: ActHeadPorts['read'] = async (at) => {
  const r = await api.overlordActHead(at);
  return 'absent' in r ? { v: 1, head: 'absent', publicKeyPem: null, at: null } : r;
};

/** The console's own ports, one object, so the effect below runs once per mount. */
const LIVE_PORTS: ActHeadPorts = { read: readHead, kept: localKept, verify: webCryptoEd25519 };

/** The view `ActHeadLine` draws: `none` until the check answers, and whenever there is no head. */
export function useActHead(ports: ActHeadPorts = LIVE_PORTS): ActHeadView {
  const [view, setView] = useState<ActHeadView>({ kind: 'none' });
  useEffect(() => {
    let live = true;
    void checkActHead(ports).then((v) => { if (live) setView(v); });
    return () => { live = false; };
  }, [ports]);
  return view;
}
