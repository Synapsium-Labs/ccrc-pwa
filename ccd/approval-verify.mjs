#!/usr/bin/env node
// ccd/approval-verify.mjs — the child's permission hook's ruling verifier (plan Task 14, spec §6.3 hook step 5,
// D-5297). Invoked ONLY by ccd/session-hook.sh's approval wait, once per ruling the server returns; installed beside
// the hook as ~/.cc-sessions/approval-verify.mjs by `ccrc install`/`ccrc update`'s agent lane and deploy.sh's.
//
//   node approval-verify.mjs <sessionId> <agentId> <digest> <nonce> <rowId> <nowMs>   < {record, sig}
//
// Reads the ruling (`{record, sig}`, `ApprovalRulingAnswer.ruling` in shared/api.ts) on stdin and the pinned public
// key from `$HOME/.ccrc/approval-signing.pub` (PEM SPKI, pinned once by the install spine, spec §6.4). Prints exactly
// one line, `allow <reason>` or `deny <reason>`, only when ALL of these hold:
//   - the Ed25519 signature is good over the record's canonical bytes (`approvalRulingBytes`' second copy, below);
//   - the record is v1 with exactly its ten fields, and names this session, agent, input digest, nonce and row;
//   - it has not expired (`expiresAt` > now);
//   - for an `allow`, its class is `ordinary` (an `escalate` or `forbidden` request is never allowed, D-5299).
// Anything else prints NOTHING and exits 0: the hook then treats it as no ruling and the prompt stays with the
// operator. Exit 2 is a usage error, which prints nothing on stdout too. Plain node, `node:*` imports only.
import { readFileSync, realpathSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** The record's ten fields, in no particular order (the canonical form sorts them). */
export const RECORD_KEYS = Object.freeze(['v', 'rowId', 'sessionId', 'agentId', 'digest', 'nonce', 'class', 'verdict', 'reason', 'expiresAt']);

// THE DOCUMENTED SECOND COPY of `canonicalJson` (shared/api.ts): code-point key order, every UTF-16 code unit
// outside printable ASCII (U+007F included) as lowercase `\uXXXX` except `\b \f \n \r \t`, `\"` and `\\`, `/` never
// escaped, integers of magnitude at most 2^53 − 1 only (`-0` is `0`). `approval-verify.test.ts` holds the two equal
// over a corpus of records.
const ESC = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' };
const str = (s) => {
  let o = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (ESC[c] !== undefined) o += ESC[c];
    else if (c < 0x20 || c >= 0x7f) o += `\\u${c.toString(16).padStart(4, '0')}`;
    else o += s[i];
  }
  return `${o}"`;
};
const cps = (s) => Array.from(s, (c) => c.codePointAt(0));
const byCp = (a, b) => {
  const x = cps(a), y = cps(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
export function canonical(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? String(v === 0 ? 0 : v) : null;
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) {
    const p = [];
    for (const x of v) { const c = canonical(x); if (c === null) return null; p.push(c); }
    return `[${p.join(',')}]`;
  }
  if (typeof v === 'object') {
    const p = [];
    for (const k of Object.keys(v).sort(byCp)) { const c = canonical(v[k]); if (c === null) return null; p.push(`${str(k)}:${c}`); }
    return `{${p.join(',')}}`;
  }
  return null;
}

/** The record's canonical bytes, or null for a record that is not exactly the ten fields. */
export function recordBytes(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null;
  const keys = Object.keys(r);
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((k) => Object.prototype.hasOwnProperty.call(r, k))) return null;
  return canonical(r);
}

/** One line of reason text: control characters become spaces, at most 1000 characters. */
const ONE_LINE_RE = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]', 'g');
const oneLine = (s) => s.replace(ONE_LINE_RE, ' ').slice(0, 1000);

/** The verdict line for a ruling, or null (print nothing). `pem` is the pinned key's text. */
export function verdictFor(ruling, expected, pem) {
  if (ruling === null || typeof ruling !== 'object') return null;
  const { record: r, sig } = ruling;
  if (typeof sig !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return null;
  const bytes = recordBytes(r);
  if (bytes === null) return null;
  let key;
  try { key = createPublicKey(pem); } catch { return null; }
  if (key.asymmetricKeyType !== 'ed25519') return null;
  let good = false;
  try { good = verify(null, Buffer.from(bytes, 'utf8'), key, Buffer.from(sig, 'base64')); } catch { return null; }
  if (!good) return null;
  if (r.v !== 1) return null;
  if (r.sessionId !== expected.sessionId || r.agentId !== expected.agentId || r.digest !== expected.digest
      || r.nonce !== expected.nonce || r.rowId !== expected.rowId) return null;
  if (!Number.isInteger(r.expiresAt) || r.expiresAt <= expected.now) return null;
  if (typeof r.reason !== 'string') return null;
  if (r.verdict === 'allow') return r.class === 'ordinary' ? `allow ${oneLine(r.reason)}` : null;
  if (r.verdict === 'deny') return `deny ${oneLine(r.reason)}`;
  return null;
}

function main(argv) {
  if (argv.length !== 6) return 2;
  const [sessionId, agentId, digest, nonce, rowIdS, nowS] = argv;
  if (!/^[0-9]+$/.test(rowIdS) || !/^[0-9]+$/.test(nowS)) return 2;
  let ruling, pem;
  try { ruling = JSON.parse(readFileSync(0, 'utf8')); } catch { return 0; }
  try { pem = readFileSync(`${process.env.HOME ?? ''}/.ccrc/approval-signing.pub`, 'utf8'); } catch { return 0; }
  const line = verdictFor(ruling, { sessionId, agentId, digest, nonce, rowId: Number(rowIdS), now: Number(nowS) }, pem);
  if (line !== null) process.stdout.write(`${line}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
