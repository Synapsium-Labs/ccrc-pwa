#!/usr/bin/env node
// deploy/gen-wrappers.mjs — Task 5 of the stage-2c wrapper-generation plan.
//
// Reads a box's `~/.ccrc/accounts.json` (path in argv[2]) and, for every
// `generated` account, writes the finished wrapper text — body plus
// provenance marker — into a STAGING directory (argv[4]), one file per
// account id, at mode 0755. It then prints a manifest to STDOUT describing
// what it found: which staged files agree with what is already installed,
// which do not, which existing files it doesn't recognise as its own, and
// which files under the "bin" directory (argv[3]) look like a wrapper this
// tool once wrote but the roster no longer names.
//
// It NEVER TOUCHES THE BIN DIRECTORY. It only READS from it — `readdirSync`
// and `readFileSync`, nothing that writes, chmods, renames or removes a
// single byte there. D5 of the plan states why: "node stages, bash mutates."
// Every actual mutation of `~/.local/bin` — write, chmod, backup, rename —
// happens in `ccd/ccrc` (Task 6, not this file), because that is where the
// wrapper-shape reader (`_wrap_parse_shape`) lives and where every refusal in
// the decision table (plan D3) has to be enforced. This file's whole job is
// to answer, truthfully and without side effects on the box's real launchers,
// "what would happen if you ran the converger right now."
//
// STDOUT is the manifest, and ONLY the manifest — nothing else is ever
// written there. STDERR is diagnostics: a validation failure's message plus,
// for a `RosterInvalid`/`WrapperInvalid`, a `gen-wrappers: remedy: …` line
// naming the fix. Exit 0 means the manifest on stdout is complete and
// trustworthy; exit 1 means the roster was invalid or a staged write failed,
// and — this is the load-bearing half of that contract — NOTHING reaches
// stdout in that case, not even a partial line. `deploy/gen-accounts.mjs`
// states the identical rule for the same reason: a half-written manifest
// that Task 6's bash reads with `IFS=$'\t' read -r kind rest` is worse than
// no manifest at all, because bash cannot tell "truncated" from "complete"
// by looking at what arrived. So every stage below — reading the roster,
// staging every account, classifying every wrapper, scanning for orphans —
// runs to completion (or throws) BEFORE a single byte reaches
// `process.stdout`; the manifest is assembled as one string and written once,
// at the very end of a successful run. Exit 2 is a usage error (wrong argc)
// and writes to stderr only, same as exit 1.
//
// ── THE MANIFEST GRAMMAR (plan D6) ────────────────────────────────────────
// Tab-separated lines on stdout, in this order:
//
//   summary\t<total>\t<generated>\t<upstream>\t<external>
//   wrapper\t<id>\t<classify>\t<equal>      (one per `generated` account)
//   protected\t<id>                         (one per NON-generated account)
//   orphan\t<id>                            (zero or more)
//
// `<classify>` is one of `absent | unreadable | foreign | ccrc-edited |
// ccrc-unmodified` — see `classify()` below for what puts a wrapper in each
// bucket. `<equal>` is `yes` or `no`: whether the on-disk text is byte-for-
// byte identical to what this run staged: always `no` when the file is
// `absent` or `unreadable`, since there is no text to compare.
//
// ── `protected` — SAYING THE UNTOUCHABLE IDS OUT LOUD (D-80) ───────────────
// One record for every account whose `exec.kind` is NOT "generated" — i.e.
// every `upstream` and `external` account. It carries no state and asks for
// nothing to be done; it exists so that "this id is an account ccrc must not
// touch" and "this id is not in the roster at all" are DIFFERENT THINGS ON THE
// WIRE. Until this record existed both arrived in Task 6's bash as the same
// thing — nothing at all — which is the overloaded-null-at-a-seam defect this
// repo bans by name, and it was not theoretical: a manifest emitting
// `wrapper<TAB>gpt<TAB>ccrc-unmodified<TAB>no` made `ccrc wrappers` rewrite an
// external account's hand-written launcher with NO FLAGS AT ALL and exit 0.
//
// TWO INDEPENDENT LOCKS ON ONE DOOR, and this is the LAXER one. This file's
// other lock is the `execKind === 'generated'` filter below, which decides
// which accounts get a `wrapper` record; `ccd/ccrc`'s reader is STRICTER than
// both — it refuses the WHOLE RUN if any id appears in both lists, rather than
// preferring either one, because an overlap is never a fact about the box, it
// is proof this file is broken and its other verdicts cannot be trusted
// either. Deliberately NOT derived from the `wrapper` list (`every account not
// named there`): that would make the two lists one statement wearing two hats,
// and a filter bug would corrupt both identically. Both are walked out of
// `roster.accounts` independently, exactly as the summary counts are.
//
// EVERY FIELD IN THIS MANIFEST IS NON-EMPTY BY CONSTRUCTION. `id` matched
// `ID_RE` (so it's at least one character of `[a-z][a-z0-9-]*`), and every
// other field is a literal drawn from a small closed set. That is what lets
// Task 6 read a record with `IFS=$'\t' read -r kind id classify equal` and
// trust the result: a tab is IFS whitespace, so bash collapses a RUN of
// them, and an empty field between two tabs would silently merge with its
// neighbour and shift every later field left. There is no such field here —
// but if a future change ever adds one that CAN be empty (an optional
// annotation, say), the safe idiom is NOT to keep relying on whitespace-
// collapsing `read`: split the line by hand on literal tabs instead, the way
// `_check_wrappers`'s roster reader already does (`ccd/ccrc-doctor-checks`).
// Silently keeping the `IFS=$'\t' read` idiom with a field that CAN be empty
// is how a manifest reader starts reading the wrong column without ever
// producing an error.
//
// ── IT NEVER OPENS A SECRET ────────────────────────────────────────────────
// `secretsFile` is a PATH that gets embedded in the generated wrapper text
// and nothing else — this file never opens, reads, stats or hashes the file
// it names, exactly as `shared/wrapper.mjs` (the emitter it calls) does not.
// Same rule, same reason: what an operator pastes into a ticket must never
// be the contents of an OAuth token file.
//
// ── TASK 6 DRIVES OFF THE MANIFEST, NEVER OFF A STAGING-DIR LISTING ───────
// This file makes NO PROMISE that the staging directory contains nothing but
// what this run staged. It only ever WRITES the `generated` ids it just
// computed; it never reads the staging directory back, and a stray file
// dropped there before the run — a leftover from a previous invocation
// against a different roster, or anything else a caller put there — is left
// exactly where it was, unreported and unremoved. The `wrapper` lines in the
// manifest are the complete and authoritative list of what THIS run staged
// and for which ids; a directory listing of the staging dir is not a
// substitute for it and can disagree with it. So Task 6 (or any future
// consumer) MUST iterate the manifest's `wrapper` records to decide what to
// install, and must never install "everything found in the staging
// directory" instead. The risk a directory-driven consumer takes on is
// concrete, not hypothetical: it would install a stale entry left over from
// an earlier run, under an account id the CURRENT roster no longer even
// declares — exactly the kind of drift this whole stage exists to prevent.

import {
  readFileSync, writeFileSync, chmodSync, readdirSync, openSync, readSync, closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';
import { generateWrapperBody, WrapperInvalid } from '../shared/wrapper.mjs';
import { markGenerated, verifyMarker } from '../shared/mark.mjs';

/** Mirrors `shared/roster.ts`'s `ID_RE` (also mirrored in
 *  `shared/roster-json.mjs` and `shared/wrapper.mjs`) — needed here as its
 *  own copy because the orphan scan below judges raw directory-entry NAMES
 *  that have never passed through either validator. A name that doesn't
 *  match this can never be an account id, so it can never be an orphan of
 *  one either. */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Reads an existing wrapper at `path` and reports what is there against the
 *  text this run staged for it. FIVE outcomes, never four: `absent` (nothing
 *  is there yet) and `unreadable` (something is there and this process could
 *  not read it) are different facts about the box, and an operator does a
 *  different thing about each — installing over an absent path is routine;
 *  installing over one you could not even read is not — so they never share
 *  a value. The other three come straight from `verifyMarker`.
 *
 * @param {string} path
 * @param {string} staged
 * @returns {{ classify: 'absent'|'unreadable'|'foreign'|'ccrc-edited'|'ccrc-unmodified', equal: 'yes'|'no' }}
 */
/** The whole text of `path`, but ONLY if its first two bytes are `#!` —
 *  otherwise `null`, with nothing past byte 2 ever read.
 *
 *  This is `_wrap_is_script`'s rule (`ccd/ccrc-wrapper-shape:75-89`) in the
 *  other language, and it is here for the reason that file's header gives for
 *  its own copy, measured: `~/.local/bin/claude` is the ~304 MB Claude Code
 *  binary. On the reference box it happens to be a SYMLINK, so the orphan
 *  scan's `isFile()` gate skipped it and nobody noticed; on a box where the
 *  binary is a regular file, a bare `readFileSync(…, 'utf8')` pulls all 304 MB
 *  into a JS string — on the box `ccrc wrappers` is most likely to be run on,
 *  as an installer, with the fleet live. "Never read a candidate whole" is the
 *  discipline; two bytes is the implementation.
 *
 *  Only files a `#!` opens can be ccrc's: `generateWrapperBody` always emits
 *  `#!/usr/bin/env bash` as line 1, so `markGenerated` always puts the marker
 *  on line 2 of a shebang file. A file that does not start `#!` therefore
 *  cannot carry a marker this pipeline wrote.
 *
 * @param {string} path
 * @returns {string | null}
 */
function readIfScript(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const head = Buffer.alloc(2);
    // An explicit `position` of 0 leaves the descriptor's own offset untouched
    // (node:fs contract), so the `readFileSync(fd)` below still starts at byte
    // 0 — no seek, and no second `open`.
    if (readSync(fd, head, 0, 2, 0) < 2) return null;
    if (head[0] !== 0x23 || head[1] !== 0x21) return null;   // '#', '!'
    return readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function classify(path, staged) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { classify: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', equal: 'no' };
  }
  return { classify: verifyMarker(text), equal: text === staged ? 'yes' : 'no' };
}

/**
 * @param {string[]} argv
 * @returns {number} the process exit code
 */
function main(argv) {
  if (argv.length !== 5) {
    process.stderr.write('usage: node deploy/gen-wrappers.mjs <accounts.json> <bin-dir> <staging-dir>\n');
    return 2;
  }
  const [, , accountsFile, binDir, stagingDir] = argv;

  let raw;
  try {
    raw = readFileSync(accountsFile, 'utf8');
  } catch (e) {
    process.stderr.write(`gen-wrappers: cannot read ${accountsFile}: ${e.message}\n`);
    return 1;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`gen-wrappers: ${accountsFile} is not valid JSON: ${e.message}\n`);
    return 1;
  }

  let roster;
  try {
    roster = rosterFromJson(json);
  } catch (e) {
    process.stderr.write(`gen-wrappers: ${e.message}\n`);
    if (e instanceof RosterInvalid) process.stderr.write(`gen-wrappers: remedy: ${e.remedy}\n`);
    return 1;
  }

  const generated = roster.accounts.filter((a) => a.execKind === 'generated');

  // Step 3: stage every generated account's finished text. Nothing is
  // written to stdout regardless of how this turns out — a staging failure
  // here (a bad account, or a staging directory this process cannot write
  // into) exits 1 with no manifest, same as an invalid roster above.
  const staged = new Map();
  for (const a of generated) {
    const dest = join(stagingDir, a.id);
    try {
      const text = markGenerated(generateWrapperBody(a, roster.upstreamId));
      writeFileSync(dest, text);
      chmodSync(dest, 0o755);
      staged.set(a.id, text);
    } catch (e) {
      process.stderr.write(`gen-wrappers: ${a.id}: ${e.message}\n`);
      if (e instanceof WrapperInvalid) process.stderr.write(`gen-wrappers: remedy: ${e.remedy}\n`);
      return 1;
    }
  }

  // Step 4: classify every generated account against what is (or isn't) at
  // `<bin-dir>/<id>` today. Read-only — see the header.
  const wrapperLines = generated.map((a) => {
    const { classify: c, equal } = classify(join(binDir, a.id), staged.get(a.id));
    return `wrapper\t${a.id}\t${c}\t${equal}`;
  });

  // Step 5: scan the bin dir for orphans — a file whose name is a legal id,
  // is NOT one of the ids just staged above, and carries a ccrc marker this
  // process can actually verify. A file this process cannot read is left
  // alone entirely: it is not counted as an orphan, not counted as anything
  // — silence beats a claim about a file nobody read. Read-only, same as
  // classify() above.
  const generatedIds = new Set(generated.map((a) => a.id));
  let entries;
  try {
    entries = readdirSync(binDir, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`gen-wrappers: cannot list ${binDir}: ${e.message}\n`);
    return 1;
  }
  const orphanLines = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!ID_RE.test(name) || generatedIds.has(name)) continue;
    // `readIfScript` answers `null` for BOTH "this process could not read it"
    // and "it is not a script at all", and that collapse is correct HERE and
    // only here: the orphan scan does the same thing about each — nothing.
    // Silence beats a claim about a file nobody read, and a non-script cannot
    // carry a marker this pipeline wrote (see `readIfScript`). It is also what
    // keeps the ~304 MB upstream binary from being read whole by an installer.
    const text = readIfScript(join(binDir, name));
    if (text === null) continue;
    if (verifyMarker(text) === 'foreign') continue;
    orphanLines.push(`orphan\t${name}`);
  }

  // Step 6: build the whole manifest, then write it once. This is the line
  // that makes the header's promise true — everything above can still fail
  // and return 1 with an empty stdout; nothing below this point can fail.
  const upstreamCount = roster.accounts.filter((a) => a.execKind === 'upstream').length;
  const externalCount = roster.accounts.filter((a) => a.execKind === 'external').length;
  // D-80. Walked out of `roster.accounts` on its own terms, exactly as the two
  // counts above are, and deliberately NOT computed as "the accounts with no
  // `wrapper` record" — see the header: two locks that share one derivation are
  // one lock. The count assertion `ccd/ccrc` makes against `<upstream>` +
  // `<external>` is what turns this from a list into a mechanism: a manifest
  // truncated exactly at these records would otherwise drop the whole lock
  // silently, which is the same hole the `wrapper` record count already closes.
  const protectedLines = roster.accounts
    .filter((a) => a.execKind !== 'generated')
    .map((a) => `protected\t${a.id}`);
  const summaryLine = `summary\t${roster.accounts.length}\t${generated.length}\t${upstreamCount}\t${externalCount}`;
  const manifest = [summaryLine, ...wrapperLines, ...protectedLines, ...orphanLines].join('\n') + '\n';

  process.stdout.write(manifest);
  return 0;
}

process.exitCode = main(process.argv);
