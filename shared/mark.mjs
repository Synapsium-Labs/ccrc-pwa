// The provenance marker — lets a writer that regenerates a file tell its
// own output apart from one a human has since hand-edited. Task 4 of the
// stage-2a plan. Its first consumer is Task 10's `deploy/gen-accounts.mjs`,
// which will call `markGenerated(generateAccountsSh(roster))` to produce
// the final text of `~/.ccrc/accounts.sh`; `verifyMarker` has no caller
// yet — it exists now because 2b's installer needs it and the brief asks
// for both halves of the pair together, not because anything in 2a reads
// its result.
//
// Plain, dependency-free-of-npm-packages ESM, like `shared/generate.mjs`
// and for the same reason: `deploy/deploy.sh` must be able to run the
// generator-plus-marker pipeline with a bare `node`, no build step, no
// `tsx`, no compiled `dist/`. That is also why `node:crypto` is fine to
// import here even though `shared/*.ts` may import nothing at all (not
// even `node:*`) — that "imports nothing" rule exists because the PWA
// bundles `shared/*.ts` into client JS, and a `node:*` import would break
// that bundle. `shared/*.mjs` files are deploy-side tooling the PWA never
// imports (only `deploy/` and `server/test/` do), so `node:crypto` costs
// nothing here. Types live alongside in the hand-written
// `shared/mark.d.mts`, exactly as with `generate.mjs`/`generate.d.mts`.
//
// This module ships ONLY the marker. The spec's full ownership mechanism
// (marker + a `classify()` over real filesystem paths + an install
// manifest) stays out on purpose: the classifier and manifest exist to
// serve an installer that doesn't land until stage 2b, so building them now
// would be code with no caller. `verifyMarker` below operates on TEXT it is
// handed, never a path — no `readFile`, no `classify(path)`, no manifest
// writer. Do not extend it to do those things as part of this task.

import { createHash } from 'node:crypto';

/** The only marker line this module ever writes or recognises. Version `1`
 *  is part of the literal text, not interpolated, so a future format change
 *  is a new constant and a new branch in `verifyMarker`, not a silent
 *  reinterpretation of old files. */
const MARKER_PREFIX = '# ccrc:generated 1 sha256=';

/** Matches a marker line exactly — a bare `# ccrc:generated 1 sha256=`
 *  followed by 64 lowercase hex characters (the digest `node:crypto`'s
 *  `sha256` produces) and nothing else. Anything that doesn't match this —
 *  wrong prefix, wrong digest length, trailing text — is not a marker line
 *  at all, so `verifyMarker` treats it the same as a file that was never
 *  marked. */
const MARKER_RE = /^# ccrc:generated 1 sha256=([0-9a-f]{64})$/;

/** @param {string | undefined} line */
function isShebangLine(line) {
  return typeof line === 'string' && line.startsWith('#!');
}

/** @param {string} s */
function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * The index the marker line occupies (or would occupy) in `lines`: 1 —
 * right after the shebang — when `lines[0]` is a shebang line, else 0. The
 * shebang must stay physically first in the file for the OS loader to
 * treat it as one (`~/.ccrc/accounts.sh` and `ccd` are both executed
 * directly), so the marker can never claim line 1 when a shebang is
 * present.
 *
 * @param {string[]} lines
 */
function markerLineIndex(lines) {
  return isShebangLine(lines[0]) ? 1 : 0;
}

/**
 * Removes a marker line from `text` if one is present at the position
 * `markerLineIndex` says it must occupy, returning the text as it would
 * have read before that marker was inserted. A no-op (returns `text`
 * unchanged) when no marker line is present there.
 *
 * This is the ONE place that decides which bytes belong to "the body" as
 * opposed to "the marker" — `markGenerated` runs input through it before
 * hashing (so re-marking an already-marked body hashes the real body, not
 * a body-plus-stale-marker), and `verifyMarker` runs its input through it
 * to reconstruct the body to re-hash. Both functions therefore agree on
 * exactly which bytes are hashed because both call this, rather than each
 * containing its own copy of "skip line 2 if there's a shebang, else skip
 * line 1" that could drift out of sync with the other.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkerLine(text) {
  const lines = text.split('\n');
  const idx = markerLineIndex(lines);
  if (idx < lines.length && MARKER_RE.test(lines[idx] ?? '')) {
    lines.splice(idx, 1);
  }
  return lines.join('\n');
}

/**
 * Stamps `body` as ccrc-generated: inserts a `# ccrc:generated 1
 * sha256=<hex>` line as line 2 when `body` starts with a shebang (so the
 * shebang stays line 1 and the file stays executable), or as line 1
 * otherwise. The hash covers `body` with any pre-existing marker line
 * already stripped (see `stripMarkerLine`) — i.e. exactly the bytes
 * `verifyMarker` will recompute the hash over when it later strips the
 * marker this call inserts back out.
 *
 * @param {string} body
 * @returns {string}
 */
export function markGenerated(body) {
  const strippedBody = stripMarkerLine(body);
  const markerLine = `${MARKER_PREFIX}${sha256Hex(strippedBody)}`;
  const lines = strippedBody.split('\n');
  lines.splice(markerLineIndex(lines), 0, markerLine);
  return lines.join('\n');
}

/**
 * Classifies `text` by comparing it against its own embedded marker:
 *
 * - `'foreign'` — no marker line is present where one would have to be
 *   (line 2 after a shebang, line 1 otherwise). A file `markGenerated`
 *   never produced.
 * - `'ccrc-unmodified'` — a marker is present and its hash matches a fresh
 *   hash of the rest of the text: this is exactly what `markGenerated`
 *   last wrote.
 * - `'ccrc-edited'` — a marker is present but the hash no longer matches:
 *   something (a human, another tool) changed the text after ccrc wrote it.
 *
 * @param {string} text
 * @returns {'ccrc-unmodified' | 'ccrc-edited' | 'foreign'}
 */
export function verifyMarker(text) {
  const lines = text.split('\n');
  const markerLine = lines[markerLineIndex(lines)];
  const match = markerLine !== undefined ? MARKER_RE.exec(markerLine) : null;
  if (!match) return 'foreign';
  const expectedHash = match[1];
  const actualHash = sha256Hex(stripMarkerLine(text));
  return actualHash === expectedHash ? 'ccrc-unmodified' : 'ccrc-edited';
}
