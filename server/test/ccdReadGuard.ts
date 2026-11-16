// THE ONE-TEXT GUARD (the ccd file split, Task 4; docs/superpowers/plans/2026-11-06-ccd-file-split.md, D-8048). ccd is one
// program in several files: ccd/ccd and the libraries its `__CCD_LIBS` table names. A test that reads ccd/ccd's bytes alone
// scans less of the program every time a slice moves code into a library, and stays green while it does. So, in every test
// process (a `setupFiles` entry of server/ and agent/), a read or copy of ccd/ccd, or a listing of ccd/, THROWS in the test
// that made it, unless the first repository stack frame below this guard is a file listed here:
//   * FILE_READERS: tests about the bytes of ccd/ccd itself (the stamp, the pins, the install, the load);
//   * PROGRAM_READERS: walks that take in ccd/lib/ beside ccd/ccd, so they see the whole program.
// Everyone else reads the program through `ccdSource()` (ccdWsHelpers.ts), copies it with `ccdTreeCopy()`, or names where a
// definition sits with `programFile()` (consolidationCensus.ts).
//
// It works by BEHAVIOUR, not spelling: it wraps `fs.readFileSync`, `fs.copyFileSync`, `fs.readdirSync` and
// `fs.promises.readFile`, then calls `syncBuiltinESMExports()`, so a named import (`import { readFileSync } from 'node:fs'`)
// sees it too, and a `read()` helper, a `scan` array, a `CCD_PATH` constant and a flat listing are all caught alike. It cannot
// see a child process: ccd-lib-shape.test.ts pins statically that no test hands ccd/ccd to grep, sed, awk, wc, cat, head or
// tail in a shell string. When `CCD_READ_GUARD_LOG` names a file, every refusal is also appended there as one line, so a
// refusal a test swallows is still counted (the split's rehearsal reads it).
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(__dirname, '..', '..');
// A setup file imports no test helper, so it names ccd's body from its directory, not through ccdWsHelpers.ts's `CCD`.
const CCD_DIR = path.join(REPO, 'ccd');
const CCD_FILE = path.join(CCD_DIR, 'ccd');
const SELF = path.join(REPO, 'server', 'test', 'ccdReadGuard.ts');
/** Wrappers that pass a listing through unchanged: a full run's tree-scan recorder (`tree-scans.setup.mjs`, loaded after this
 *  guard, so its wrapper sits outside it) records which roots a test lists and calls the lister it wrapped. A frame in one is
 *  passed over like this guard's own, and the caller below it is judged. */
const TRANSPARENT = new Set([path.join(REPO, '.github', 'ci', 'tree-scanners.mjs'), path.join(REPO, 'server', 'test', 'tree-scans.setup.mjs')]);

/** Files about the bytes of ccd/ccd itself: they read, copy or list the file on purpose. Repo-relative. */
export const FILE_READERS: readonly string[] = [
  'server/test/ccdWsHelpers.ts',              // ccdSource(), ccdTreeCopy(), installedCcdBody() and installDirectEntry(): the one place that reads it
  'server/test/ccdLibTable.ts',               // ccdLibNames(): the one `__CCD_LIBS` line every test-side list derives from
  'server/test/ccd-lib-load.test.ts',         // the load, its pins and its refusals
  'server/test/ccd-lib-shape.test.ts',        // the table and the libraries' shape
  'server/test/ccd-entry-install.test.ts',    // the installer's output, byte for byte
  'server/test/ccd-install-stamp.test.ts',    // the line-2 stamp
  'server/test/ownership.test.ts',            // the installed modes and owners
  'server/test/ccrc-restamp.test.ts',         // restamp refuses ccd/ccd
  'server/test/build-release.test.ts',        // the release ships the body's bytes, each under its MANIFEST digest
  'agent/test/deploy-verify.test.ts',         // deploy.sh places the body's bytes beside its libraries
  'agent/test/ccd-entry-exec.test.ts',        // the launcher execs the installed body
  'server/test/growth-check.test.ts',         // each tracked file's own line count: the growth check measures files, and the program row
  'server/test/ci-fast-plan.test.ts',         // lists ccd/ on purpose: the tree-scan capture records a ccd scan
];

/** Walks that take in ccd/lib/ beside ccd/ccd, so they see the whole program. Repo-relative. */
export const PROGRAM_READERS: readonly string[] = [
  'server/test/consolidationCensus.ts',       // ccdSourceLines(): ccd/ccd, then every library of the table
  'shared/hook-helpers.mjs',                  // the generated helpers read the spliced program
  'server/test/installTreeFixture.ts',        // TREE_FILES: the body with every library of the table (CCD_LIB_FILES)
  'server/test/census-w5/redactors.ts',       // ccd/ccd as ccdProgramBodies(), its libraries included; ccd/*.sh beside
  'server/test/single-definition/helpers.ts', // the roots walked whole; isBash takes .sh
  'server/test/history-replay.test.ts',       // a placed tree links every entry of ccd/, lib/ among them
  'server/test/ccd-harness-integrity.test.ts',// shippedShellScripts(): ccd/ walked whole, lib/ among it
  'server/test/session-hook.test.ts',         // SHELL_CORPUS: ccd/ and every ccd/lib/*.sh
  'server/test/ccd-account-auth.test.ts',     // the registry census: ccd/'s scripts and every ccd/lib/*.sh
  'server/test/ccd-id-cap.test.ts',           // the name census walks ccd/ whole; its _reg_get_to check reads the defining file
  'server/test/ccd-collect-recycle-pins.test.ts', // ccd/ and deploy/ walked whole
  'server/test/ccd-child-tmpdir.test.ts',     // ccd/ and deploy/ walked whole
  'server/test/ccd-child-tmproot-witness.test.ts', // shipped(): ccd/'s shell files and every ccd/lib/*.sh
  'server/test/ccd-reg-id-ok.test.ts',        // ccd/ listed recursively, holders named by programFile()
  'server/test/routing-env-census.test.ts',   // CCD_SHIPPED: ccd/'s scripts and every ccd/lib/*.sh
  'server/test/ccd-typing-check.test.ts',     // every program in ccd/ but ccd: the body and its libraries are ccd, scanned through ccdSource()
  'server/test/ccd-ws-lease-mark-argv.test.ts', // ccd/ listed for its skill directories; no program file is read
  'server/test/single-definition/switches-history.test.ts', // ccd/ and deploy/ walked whole; ccd/ccd read as the program (bashText)
  'server/test/ccrc-versioned-audit.test.ts', // ccd/ walked whole, lib/ among it
  'server/test/census-w5/singleWriters.ts',   // ccd/ccd as ccdProgramBodies(), its libraries included; ccd/*.sh beside
  'server/test/ccd-collect-record.test.ts',   // every program in ccd/ but ccd: the body and its libraries are ccd
  'server/test/citations.test.ts',            // every tracked file, each library among them
  'server/test/providers.test.ts',            // every tracked file, each library among them
  'server/test/workflow-control-census.test.ts', // every tracked file under ccd/, each library among them
  'server/test/testbox-knobs.test.ts',        // ccd/, deploy/ and agent/src walked whole
  'server/test/units-limitcore.test.ts',      // ccd/ walked whole for unit files; no program file is read
  'server/test/ccd-land-probe-readonly.test.ts', // every tracked file, each library among them
  'server/test/ccd-python-reader-census.test.ts', // ccd/ listed recursively for its Python programs
  'server/test/ccd-route-spawn.test.ts',      // the shipped tree walked whole; a holder named by programFile()
  'server/test/census-w5/accountMarkers.ts',  // ccdProgramBodies(): ccd/ccd and every library of the table; ccd/'s programs beside
  'server/test/census-kernel/baseUrl.ts',     // the roots walked whole
  'server/test/census-w3/claimant.ts',        // ccd/ walked whole
  'server/test/license.test.ts',              // its walks take in ccd/ whole; ccd/ccd's own lines are read as the program
  'server/test/ci-pipeline.test.ts',          // every tracked shell file, each library among them
  'server/test/graph-r2-consumers.test.ts',   // every tracked file, each library among them
  'server/test/graph-resolve.test.ts',        // every tracked file, each library among them
  'server/test/modelenv-single-writer.test.ts', // every tracked file, each library among them
  'server/test/source-bytes.test.ts',         // every tracked file's bytes, each library among them
  'server/test/no-default-saving-keystroke.test.ts', // ccd/ walked whole, its lib among it
  'server/test/single-definition/roster-card.test.ts', // ccd/ walked whole for its jq programs
  'server/test/testbox-config-file.test.ts',  // ccd/ listed for its testbox-* files; no program file is read
  'server/test/single-definition/advance-switches.test.ts', // BASH walked whole (ccd/lib/*.sh among it); a writer named by programFile()
  'server/test/single-definition/late-census.test.ts', // every tracked file, each library among them
  'server/test/single-definition/vocabularies.test.ts', // every tracked file, each library among them; ccd's own lines through ccdSource()
  'server/test/single-definition/injected-prompts.test.ts', // ccd/ walked recursively; ccd/ccd as ccdSource(), its libraries included
  'server/test/codex-bridge-live-tools.test.ts', // the shipped roots walked whole
  'server/test/delegation-wave3.integration.test.ts', // ccd/ccd and ccd/lib walked together; a holder in a library allowed as ccd/ccd (programFile())
  'server/test/deviation-refs.test.ts',       // every tracked file, each library among them
  'server/test/docs-parity.test.ts',          // its roots' tracked files, each library among them; ccd's lines through ccdSource()
  'server/test/graph-build.test.ts',          // every tracked file under ccd/, each library among them
  'server/test/shellcheck-ratchet.test.ts',   // every tracked bash file, each library among them; the group linted over the splice
  'server/test/topology-clean.test.ts',       // every tracked file, each library among them
  'server/test/continued-in-parity.test.ts',  // every tracked file under ccd/, each library among them
  'server/test/macos-platform.test.ts',       // ccd/ listed for its shebang'd scripts; ccd itself read as ccdSource(), every library in it
];

const allowed = new Set([...FILE_READERS, ...PROGRAM_READERS]);

/** What a path argument names, resolved against the process's cwd; null for a descriptor or anything else. */
function target(p: unknown): string | null {
  if (typeof p === 'string') return path.resolve(p);
  if (p instanceof URL) return p.protocol === 'file:' ? fileURLToPath(p) : null;
  if (Buffer.isBuffer(p)) return path.resolve(p.toString('utf8'));
  return null;
}

/** The first repository file in the stack below this guard (repo-relative), or null when none is (vitest's own reads). */
export function firstRepoFrame(stack: string): string | null {
  for (const line of stack.split('\n').slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^():]+):\d+:\d+\)?\s*$/.exec(line);
    if (!m) continue;
    const file = m[1]!.startsWith('file://') ? fileURLToPath(m[1]!) : m[1]!;
    if (file === SELF || TRANSPARENT.has(file) || !file.startsWith(REPO + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    return path.relative(REPO, file).split(path.sep).join('/');
  }
  return null;
}

/** The refusal for an operation on `abs` from the stack `stack`, or null when it is allowed. Pure, for the guard's own rows. */
export function guardRefusal(op: 'read' | 'copy' | 'list', abs: string, stack: string): string | null {
  const isFile = abs === CCD_FILE && op !== 'list';
  const isDir = abs === CCD_DIR && op === 'list';
  if (!isFile && !isDir) return null;
  const caller = firstRepoFrame(stack);
  if (caller === null || allowed.has(caller)) return null;
  const what = isDir ? 'lists ccd/ flat' : `${op === 'copy' ? 'copies' : 'reads'} ccd/ccd alone`;
  const fix = isDir ? 'list ccd/lib/*.sh too, and add the walk to PROGRAM_READERS'
    : op === 'copy' ? 'copy the body and every library together with ccdTreeCopy() (ccdWsHelpers.ts)'
      : 'read the program through ccdSource() (ccdWsHelpers.ts), or name a definition\'s file with programFile() (consolidationCensus.ts)';
  return `ccdReadGuard: ${caller} ${what}, so it misses the code in ccd/lib/ (the ccd file split, D-8048): ${fix}`;
}

const MARK = Symbol.for('ccrc.ccdReadGuard');
type Guarded = typeof fs & { [MARK]?: true };

function check(op: 'read' | 'copy' | 'list', p: unknown): void {
  const abs = target(p);
  if (abs === null || (abs !== CCD_FILE && abs !== CCD_DIR)) return;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 64;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  const refusal = guardRefusal(op, abs, stack);
  if (refusal === null) return;
  const log = process.env['CCD_READ_GUARD_LOG'];
  if (log) {
    try { fs.appendFileSync(log, `${refusal}\n`); } catch { /* the throw below still reports it */ }
  }
  throw new Error(refusal);
}

if (!(fs as Guarded)[MARK]) {
  (fs as Guarded)[MARK] = true;
  const readFileSync = fs.readFileSync;
  const copyFileSync = fs.copyFileSync;
  const readdirSync = fs.readdirSync;
  const readFile = fs.promises.readFile;
  fs.readFileSync = function guardedReadFileSync(this: unknown, p: unknown, ...rest: unknown[]) {
    check('read', p);
    return (readFileSync as (...a: unknown[]) => unknown).call(this, p, ...rest);
  } as typeof fs.readFileSync;
  fs.copyFileSync = function guardedCopyFileSync(this: unknown, src: unknown, ...rest: unknown[]) {
    check('copy', src);
    return (copyFileSync as (...a: unknown[]) => unknown).call(this, src, ...rest);
  } as typeof fs.copyFileSync;
  fs.readdirSync = function guardedReaddirSync(this: unknown, p: unknown, ...rest: unknown[]) {
    check('list', p);
    return (readdirSync as (...a: unknown[]) => unknown).call(this, p, ...rest);
  } as typeof fs.readdirSync;
  fs.promises.readFile = function guardedReadFile(this: unknown, p: unknown, ...rest: unknown[]) {
    try {
      check('read', p);
    } catch (e) {
      return Promise.reject(e);
    }
    return (readFile as (...a: unknown[]) => unknown).call(this, p, ...rest);
  } as typeof fs.promises.readFile;
  syncBuiltinESMExports();
}
