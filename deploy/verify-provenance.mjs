// verify-provenance.mjs — is this tarball the one a release workflow of
// THIS repo built for THIS tag? (design 2026-09-20 §5)
//
// Four checks, on either backend: the bundle's signature over the blob's
// digest against the Sigstore public-good trust root; the in-toto subject's
// NAME against `ccrc-<tag>.tar.gz` (a genuinely attested tarball served
// under another tag's asset path refuses here — §5 refusal 3); the
// certificate's OIDC issuer; and its SAN against EXACTLY TWO workflow URIs
// built from owner/repo/tag. Nothing wider: an identity of `<owner>/<repo>`
// alone would accept an attestation minted by any workflow on any branch.
//
// RUN FROM THE INSTALLED TREE (decision 12): `ccrc update` resolves this
// file beside its own ccrc (`$CCRC_HERE/../deploy/`), never out of the
// tarball it is verifying. Its dependencies are the server package's
// production dependencies, resolved through `../server/node_modules` — placed
// by the same `npm ci --omit=dev` that installs the server on every role — so
// a verifier that shipped is a verifier that runs.
//
// TWO BACKENDS (the spike, plan Task 1, chose the default):
//   sigstore — @sigstore/verify against the VENDORED trusted root beside this
//              file; CCRC_SIGSTORE_TRUSTED_ROOT overrides it (a by-hand
//              refresh for a root that has gone stale). No network.
//   gh       — `gh attestation verify` (gh >= 2.49) with the same constraints
//              spelled on its argv. gh hashes the file itself, so this arm
//              takes --blob only and checks the subject NAME here.
//
// --blob-sha256 exists for callers that already hold the digest (the test
// fixtures are bundles + digests, not 3 MB tarballs); `ccrc update` always
// passes --blob.
//
// Dependency majors (D-3131): @sigstore/verify@^3.1, @sigstore/bundle@^4.0
// and @sigstore/protobuf-specs@^0.5 — not the newest majors the plan
// originally named — because the v4/v5 majors declare
// `engines.node ^22.22.2 || ^24.15.0` and the fleet (and this box) run node
// 24.14.1. Export names (`Verifier`, `toSignedEntity`, `toTrustMaterial`,
// `bundleFromJSON`, `TrustedRoot`) were re-measured on the installed v3/v4
// modules and match the spike's v4.1.2/v5.0.0 names verbatim.
//
// exit 0 verified (one stdout line naming the identity); 1 refused (one
// stderr line saying why); 2 usage.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ISSUER = 'https://token.actions.githubusercontent.com';
const DEFAULT_ROOT = path.join(HERE, 'sigstore-trusted-root.jsonl');
const DEFAULT_BACKEND = 'sigstore';
const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

function usage(code) {
  process.stderr.write('usage: node verify-provenance.mjs --bundle <file> (--blob <file> | --blob-sha256 <hex>) --tag vX.Y.Z --owner <owner> --repo <repo> [--backend sigstore|gh] [--trusted-root <file>]\n');
  process.exit(code);
}
function refuse(why) {
  process.stderr.write(`verify-provenance: ${why}\n`);
  process.exit(1);
}

const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const take = () => { if (i + 1 >= argv.length) usage(2); i += 1; return argv[i]; };
  switch (a) {
    case '--bundle': opt.bundle = take(); break;
    case '--blob': opt.blob = take(); break;
    case '--blob-sha256': opt.digest = take(); break;
    case '--tag': opt.tag = take(); break;
    case '--owner': opt.owner = take(); break;
    case '--repo': opt.repo = take(); break;
    case '--backend': opt.backend = take(); break;
    case '--trusted-root': opt.root = take(); break;
    case '-h': case '--help': usage(0); break;
    default: usage(2);
  }
}
if (!opt.bundle || !opt.tag || !opt.owner || !opt.repo) usage(2);
if ((opt.blob ? 1 : 0) + (opt.digest ? 1 : 0) !== 1) usage(2);
if (!TAG.test(opt.tag)) usage(2);
if (opt.digest !== undefined && !/^[0-9a-f]{64}$/.test(opt.digest)) usage(2);
if (!NAME.test(opt.owner) || !NAME.test(opt.repo)) usage(2);
const backend = opt.backend ?? DEFAULT_BACKEND;
if (backend !== 'sigstore' && backend !== 'gh') usage(2);
if (backend === 'gh' && !opt.blob) usage(2);

const rootPath = opt.root ?? process.env.CCRC_SIGSTORE_TRUSTED_ROOT ?? DEFAULT_ROOT;
const expectSubject = `ccrc-${opt.tag}.tar.gz`;
// EXACTLY these two. release-main.yml signs at refs/heads/main on every
// auto-patch; release.yml signs at the tag it was pushed with.
const identities = [
  `https://github.com/${opt.owner}/${opt.repo}/.github/workflows/release-main.yml@refs/heads/main`,
  `https://github.com/${opt.owner}/${opt.repo}/.github/workflows/release.yml@refs/tags/${opt.tag}`,
];

/** One JSON object (a release asset) or JSON lines (what `gh attestation
 *  download` writes). Every bundle in the file is tried. */
function readBundles(file) {
  const text = readFileSync(file, 'utf8');
  try { return [JSON.parse(text)]; } catch { /* JSONL */ }
  const out = text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  if (out.length === 0) refuse(`${file} holds no bundle`);
  return out;
}
/** The in-toto statement inside a DSSE bundle — read from the raw JSON, so
 *  the check does not depend on either backend's object model. */
function statementOf(json) {
  const env = json.dsseEnvelope;
  if (!env || typeof env.payload !== 'string') return null;
  if (env.payloadType !== 'application/vnd.in-toto+json') return null;
  let st;
  try { st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')); } catch { return null; }
  return Array.isArray(st.subject) ? st : null;
}
/** The subject NAME, and — when the caller computed it — the digest. */
function subjectCheck(st, digest) {
  if (st === null) refuse('the bundle carries no in-toto statement — not an attestation');
  const named = st.subject.filter((s) => s && s.name === expectSubject);
  if (named.length === 0) {
    refuse(`the attestation's subject is ${st.subject.map((s) => s?.name ?? '?').join(', ')}, not ${expectSubject} — a tarball attested under another tag`);
  }
  if (digest !== null && !named.some((s) => s.digest && s.digest.sha256 === digest)) {
    refuse(`the attestation names ${expectSubject} with sha256 ${named[0].digest?.sha256 ?? '?'}, but the blob's is ${digest} — not the bytes the workflow built`);
  }
}

const bundles = readBundles(opt.bundle);
const digest = opt.digest ?? createHash('sha256').update(readFileSync(opt.blob)).digest('hex');

if (backend === 'sigstore') {
  const req = createRequire(path.join(HERE, '..', 'server', 'package.json'));
  const { Verifier, toSignedEntity, toTrustMaterial } = req('@sigstore/verify');
  const { bundleFromJSON } = req('@sigstore/bundle');
  const { TrustedRoot } = req('@sigstore/protobuf-specs');
  const roots = readFileSync(rootPath, 'utf8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => TrustedRoot.fromJSON(JSON.parse(l)));
  if (roots.length === 0) refuse(`${rootPath} holds no trusted root`);
  let verified = null;
  let last = null;
  for (const json of bundles) {
    let entity;
    try { entity = toSignedEntity(bundleFromJSON(json)); } catch (e) { last = e; continue; }
    for (const root of roots) {
      const v = new Verifier(toTrustMaterial(root), { ctlogThreshold: 1, tlogThreshold: 1, tsaThreshold: 0 });
      for (const san of identities) {
        try {
          v.verify(entity, { subjectAlternativeName: san, extensions: { issuer: ISSUER } });
          verified = { json, san };
          break;
        } catch (e) { last = e; }
      }
      if (verified) break;
    }
    if (verified) break;
  }
  if (!verified) {
    refuse(`no bundle verified against the trusted root for either release workflow of ${opt.owner}/${opt.repo} (last reason: ${last?.message ?? 'none'})`);
  }
  subjectCheck(statementOf(verified.json), digest);
  process.stdout.write(`verified ${expectSubject} sha256:${digest} as ${verified.san} (sigstore)\n`);
  process.exit(0);
}

// gh backend: one call per identity, the same constraints on the argv. gh
// compares the blob's digest against the statement itself; the NAME is ours.
let accepted = null;
let lastErr = '';
for (const san of identities) {
  const r = spawnSync('gh', ['attestation', 'verify', opt.blob, '--bundle', opt.bundle, '--repo', `${opt.owner}/${opt.repo}`,
    '--cert-identity', san, '--cert-oidc-issuer', ISSUER, '--custom-trusted-root', rootPath, '--deny-self-hosted-runners'],
  { encoding: 'utf8' });
  if (r.error) refuse(`gh could not be run (${r.error.message}) — the gh backend needs gh >= 2.49 on PATH`);
  if (r.status === 0) { accepted = san; break; }
  lastErr = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop() ?? '';
}
if (accepted === null) {
  refuse(`gh attestation verify refused for either release workflow of ${opt.owner}/${opt.repo} (last: ${lastErr})`);
}
const statements = bundles.map(statementOf).filter((s) => s !== null);
if (statements.length === 0) refuse('the bundle carries no in-toto statement — not an attestation');
if (!statements.some((st) => st.subject.some((s) => s && s.name === expectSubject))) {
  subjectCheck(statements[0], null);
}
process.stdout.write(`verified ${expectSubject} sha256:${digest} as ${accepted} (gh)\n`);
