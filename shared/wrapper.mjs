// shared/wrapper.mjs — THE ACCOUNT WRAPPER WRITER. One account in, the exact
// text of `~/.local/bin/<id>` out. Its counterpart is the READER,
// `_wrap_parse_shape` in `ccd/ccrc-wrapper-shape`, and the two are in
// different languages with no way to share code — so what keeps them in step
// is `server/test/wrapper-roundtrip.test.ts`, which runs the real bash reader
// over this function's real output on every suite run. Read that test before
// changing a single byte of the template below; a change here that the reader
// does not accept turns every wrapper on every box into a file ccrc calls
// foreign and refuses to touch.
//
// Plain, dependency-free ESM, like `shared/generate.mjs` and `shared/mark.mjs`
// and for the same reason: a bare `node` runs this, with no build step.
//
// ── WHY IT REFUSES RATHER THAN ESCAPES ────────────────────────────────────
// `shared/generate.mjs` escapes (`dqEscape`) because its output is bash that
// only bash reads. This file's output is bash that a PARSER also reads, and
// that parser (`_wrap_parse_shape`) matches by reconstructing the exact line
// it expects and comparing strings whole. A backslash-escaped suffix produces
// a line the reader rejects — so escaping here would emit a file ccrc itself
// classifies as foreign and then refuses to manage. Refusal is the only
// answer that keeps writer and reader in agreement, and it is loud.
//
// ── IT NEVER READS A SECRET ───────────────────────────────────────────────
// `secretsFile` is a PATH that gets embedded and nothing else. This module
// does not open, stat, source or hash the file it names. Same rule the reader
// states in its own header, for the same reason: doctor's output is what an
// operator pastes into a ticket.

/** `shared/roster.ts`'s `ID_RE`. The FOURTH copy — the other three are
 *  `shared/roster.ts`, `deploy/gen-accounts.mjs` and `ccrc-wrapper-shape`'s
 *  `WRAPPER_ID_RE` — and a deliberate one, because this function
 *  consumes its argument STRUCTURALLY, exactly as `generateAccountsSh` does,
 *  with no runtime proof it ever passed through `parseRoster`. This is the
 *  writer's own lock on its own door. */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** `shared/roster.ts`'s `SUFFIX_SAFE_RE`, and `ccrc-wrapper-shape`'s
 *  `WRAPPER_SUFFIX_SAFE_RE` — the reader's copy is the one that matters here,
 *  because a suffix this accepts and the reader does not is a wrapper ccrc
 *  writes and then disowns. They are the same expression on purpose. */
const SUFFIX_SAFE_RE = /^\.[A-Za-z0-9._-]+$/;

/** `shared/roster.ts`'s `SECRETS_SAFE_RE` (Task 1). */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;

export class WrapperInvalid extends Error {}

/** @param {string} message @param {string} remedy @returns {never} */
function bad(message, remedy) {
  const e = new WrapperInvalid(message);
  e.remedy = remedy;
  throw e;
}

/**
 * The finished, UNMARKED text of one generated account's wrapper. The caller
 * runs it through `markGenerated` (shared/mark.mjs) to stamp ownership;
 * keeping the two apart is what lets the round-trip test check the body and
 * the marked file separately.
 *
 * Ends in exactly one newline — a shell script whose last line has no
 * terminator is legal but every tool that reads it line-wise has to special-
 * case the tail, `_wrap_parse_shape`'s `mapfile` included.
 *
 * @param {{id: string, configDirSuffix: string, execKind: string, secretsFile?: string}} account
 * @param {string} upstreamId
 * @returns {string}
 */
export function generateWrapperBody(account, upstreamId) {
  const id = account.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    bad(`cannot write a wrapper for an account whose id ${JSON.stringify(id)} is not a legal id.`,
      'Rename it to match ^[a-z][a-z0-9-]{0,31}$ — it becomes a filename under ~/.local/bin.');
  }
  // The ONE kind ccrc owns. `upstream` is the Claude Code binary and
  // `external` is somebody else's launcher; writing either is data loss, so
  // this function cannot be talked into producing text for them at all.
  if (account.execKind !== 'generated') {
    bad(`account "${id}" has exec.kind ${JSON.stringify(account.execKind)}, and ccrc writes a `
      + 'wrapper only for "generated".',
      `Leave $HOME/.local/bin/${id} alone — ccrc never writes an upstream or external account.`);
  }
  if (typeof upstreamId !== 'string' || !ID_RE.test(upstreamId)) {
    bad(`the roster's upstream account id ${JSON.stringify(upstreamId)} is not a legal id, so `
      + `"${id}"'s wrapper has nothing to exec.`,
      'Fix the id of the account whose exec.kind is "upstream" in ~/.ccrc/accounts.json.');
  }
  const suffix = account.configDirSuffix;
  if (typeof suffix !== 'string' || suffix === '.' || !SUFFIX_SAFE_RE.test(suffix)) {
    bad(`account "${id}" has a configDirSuffix ${JSON.stringify(suffix)} that cannot be written `
      + 'into a double-quoted bash string.',
      `Set configDirSuffix for "${id}" to a dot-prefixed name under $HOME (e.g. ".${id}") using `
      + 'only letters, digits, ".", "-" and "_".');
  }
  const secrets = account.secretsFile;
  if (secrets !== undefined) {
    if (typeof secrets !== 'string' || secrets === '' || secrets.startsWith('/')
      || secrets.endsWith('/') || secrets.includes('..') || !SECRETS_SAFE_RE.test(secrets)) {
      bad(`account "${id}" has an exec.secretsFile ${JSON.stringify(secrets)} that cannot be `
        + 'written into a double-quoted bash string.',
        `Set exec.secretsFile for "${id}" to a path relative to $HOME (e.g. `
        + `".cc-secrets/${id}-oauth.env") using only letters, digits, ".", "-", "_" and "/".`);
    }
  }

  // EVERY LINE BELOW IS MATCHED BYTE FOR BYTE BY `_wrap_parse_shape`. The
  // comment line is the one exception: the reader strips blank and
  // comment-only lines before counting, which is what lets a generated
  // wrapper carry both this notice and the provenance marker.
  const secretsLine = secrets === undefined
    ? ''
    : `[ -r "$HOME/${secrets}" ] && . "$HOME/${secrets}"\n`;
  return '#!/usr/bin/env bash\n'
    + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
    + `export CLAUDE_CONFIG_DIR="$HOME/${suffix}"\n`
    + secretsLine
    + `exec "$HOME/.local/bin/${upstreamId}" "$@"\n`;
}
