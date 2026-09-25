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
//              file; CCRC_SIGSTORE_TRUSTED_ROOT overrides it — read from the
//              process environment unconditionally, so whoever controls that
//              environment (a shell, or the user manager an unattended unit
//              inherits it from) can substitute the root, not only an
//              operator refreshing one that has gone stale. No network.
//   gh       — `gh attestation verify` (gh >= 2.49) with the same constraints
//              spelled on its argv, plus `--format json` (D-3133). gh hashes
//              the file itself, so this arm takes --blob only; it checks the
//              subject NAME and digest against the statements gh itself
//              returned as verified, never against the bundle file's own.
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
// stderr line saying why); 2 usage; 3 the verifier could not RUN at all —
// its own dependencies would not load (D-3144). 3 is deliberately outside
// {0,1}: `_upd_fetch` reads 1 as a verdict ON THE BUNDLE and says so with
// --allow-unsigned denied, which is a false claim about the release when
// the real fault is a half-finished `npm ci` on this box.
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
 *  the check does not depend on either backend's object model. Used by the
 *  sigstore arm only: it binds the check to the entry that verified. The gh
 *  arm reads statements from gh's own `--format json` output instead
 *  (D-3133) — never from the bundle file. */
function statementOf(json) {
  const env = json.dsseEnvelope;
  if (!env || typeof env.payload !== 'string') return null;
  if (env.payloadType !== 'application/vnd.in-toto+json') return null;
  let st;
  try { st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')); } catch { return null; }
  return Array.isArray(st.subject) ? st : null;
}
/** The subject NAME, and — when the caller supplied it — the digest.
 *  Returns the refusal reason, or null when the statement passes. */
function subjectFailure(st, digest) {
  if (st === null) return 'the bundle carries no in-toto statement — not an attestation';
  const named = st.subject.filter((s) => s && s.name === expectSubject);
  if (named.length === 0) {
    return `the attestation's subject is ${st.subject.map((s) => s?.name ?? '?').join(', ')}, not ${expectSubject} — a tarball attested under another tag`;
  }
  if (digest !== null && !named.some((s) => s.digest && s.digest.sha256 === digest)) {
    return `the attestation names ${expectSubject} with sha256 ${named[0].digest?.sha256 ?? '?'}, but the blob's is ${digest} — not the bytes the workflow built`;
  }
  return null;
}
function subjectCheck(st, digest) {
  const why = subjectFailure(st, digest);
  if (why !== null) refuse(why);
}
/** D-3133: gh's own `--format json` output, parsed once per accepted call.
 *  Measured on gh 2.101.0 offline against the vendored root: an array with
 *  one element per bundle entry gh verified, each
 *  `{ attestation, verificationResult: { statement: { subject: [...] }, ... } }`.
 *  Anything else — a parse error, a non-array, an element missing
 *  `verificationResult.statement.subject` — is refused rather than trusted;
 *  `--format json`'s presence below gh 2.49 is unmeasured, so this is the
 *  honest fallback, not a weaker check. */
function ghStatements(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { parsed = null; }
  const ok = Array.isArray(parsed) && parsed.length > 0
    && parsed.every((e) => e && e.verificationResult && e.verificationResult.statement && Array.isArray(e.verificationResult.statement.subject));
  if (!ok) {
    refuse(`gh's --format json output was not understood (gh >= 2.49 with --format json is required): ${(stdout ?? '').slice(0, 120)}`);
  }
  return parsed.map((e) => e.verificationResult.statement);
}

// D-3144: loading the sigstore deps is a DEPENDENCY problem, not a verdict on
// the bundle — a partial `npm ci` under server/node_modules (`_inst_tree`'s
// own comment calls this the verb's most likely failure) must not read as
// "provenance verification FAILED" and close --allow-unsigned's escape
// hatch for the wrong reason. Kept OUTSIDE the D-3134 catch below (and it
// `process.exit`s directly, so even a later refactor that widened that catch
// could not re-catch this into `refuse()`): exit 3, outside {0,1}, so
// `_upd_fetch`'s `elif [ "$vrc" -ne 0 ]` arm reports "could not RUN the
// installed verifier" — the sentence D-3142 wrote for precisely this shape.
let Verifier, toSignedEntity, toTrustMaterial, bundleFromJSON, TrustedRoot;
if (backend === 'sigstore') {
  try {
    const req = createRequire(path.join(HERE, '..', 'server', 'package.json'));
    ({ Verifier, toSignedEntity, toTrustMaterial } = req('@sigstore/verify'));
    ({ bundleFromJSON } = req('@sigstore/bundle'));
    ({ TrustedRoot } = req('@sigstore/protobuf-specs'));
  } catch (e) {
    // ONE line (a MODULE_NOT_FOUND's own message embeds a "Require stack:"
    // trailer with its own newlines — collapsed here so this stays one
    // stderr line, per contract, instead of reading as several).
    const why = (e && e.message ? e.message : String(e)).replace(/\s*\n\s*/g, '; ');
    process.stderr.write(`verify-provenance: could not load the sigstore verifier's dependencies (${why}) — a local dependency problem, not a verdict on the bundle\n`);
    process.exit(3);
  }
}

// D-3134: everything below can throw on a missing or truncated file — the
// realistic shape of a half-downloaded bundle from Task 12's `_upd_fetch`.
// Funnel any such error into the one-line `verify-provenance: <why>` refusal
// the contract promises, instead of a node stack trace; `refuse`/`usage`
// exit directly and never throw, so this catch only ever sees a genuine
// unhandled read/parse failure.
try {
  const bundles = readBundles(opt.bundle);
  const digest = opt.digest ?? createHash('sha256').update(readFileSync(opt.blob)).digest('hex');

  if (backend === 'sigstore') {
    const roots = readFileSync(rootPath, 'utf8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => TrustedRoot.fromJSON(JSON.parse(l)));
    if (roots.length === 0) refuse(`${rootPath} holds no trusted root`);
    let verified = null;
    let last = null;
    for (const json of bundles) {
      let entity;
      try { entity = toSignedEntity(bundleFromJSON(json)); } catch (e) { last = e; continue; }
      for (const root of roots) {
        // D-3145: `tsaThreshold: 0` used to sit here. @sigstore/verify@3.1.1's
        // constructor reads `timestampThreshold: options.timestampThreshold ??
        // options.tsaThreshold ?? 1`, so the `0` propagated and made
        // `verifyTimestamps` accept an empty list — which meant
        // `verifyCertificate` ran `verifyCertificateChain` zero times,
        // leaving the chain-to-trusted-CA and cert-validity-window checks
        // unrun. Dropped so the library's own default (require a timestamp)
        // applies; the intent was "do not require a TSA timestamp", not
        // "skip the chain/validity checks".
        const v = new Verifier(toTrustMaterial(root), { ctlogThreshold: 1, tlogThreshold: 1 });
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

  // gh backend: one call per identity, the same constraints on the argv,
  // plus --format json (D-3133). gh compares the blob's digest against the
  // statement itself; the subject NAME and digest are checked here, but
  // ONLY against the statements gh itself returned as verified under the
  // accepted identity — never against the bundle file's own statements,
  // which could carry an appended, unsigned entry naming the expected
  // subject and defeat the tag binding.
  let acceptedSan = null;
  let acceptedStatements = null;
  let lastErr = '';
  for (const san of identities) {
    const r = spawnSync('gh', ['attestation', 'verify', opt.blob, '--bundle', opt.bundle, '--repo', `${opt.owner}/${opt.repo}`,
      '--cert-identity', san, '--cert-oidc-issuer', ISSUER, '--custom-trusted-root', rootPath, '--deny-self-hosted-runners', '--format', 'json'],
    { encoding: 'utf8' });
    if (r.error) refuse(`gh could not be run (${r.error.message}) — the gh backend needs gh >= 2.49 on PATH`);
    if (r.status === 0) { acceptedSan = san; acceptedStatements = ghStatements(r.stdout ?? ''); break; }
    lastErr = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop() ?? '';
  }
  if (acceptedSan === null) {
    refuse(`gh attestation verify refused for either release workflow of ${opt.owner}/${opt.repo} (last: ${lastErr})`);
  }
  const failures = acceptedStatements.map((st) => subjectFailure(st, digest));
  if (!failures.includes(null)) {
    refuse(failures[0]);
  }
  process.stdout.write(`verified ${expectSubject} sha256:${digest} as ${acceptedSan} (gh)\n`);
} catch (e) {
  refuse(e && e.message ? e.message : String(e));
}
