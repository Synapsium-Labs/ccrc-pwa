# The test box's install inputs include the files the lifecycle scripts run: plan

`2026-11-23-testbox-end-to-end.md` made the parity check pass end to end and left one gap: no pristine install was ever
used. This plan closes it without asking any operator to list a file. Spec
`docs/superpowers/specs/2026-10-28-test-box-design.md` §2.2 "Pristine installs" and §2.6.

## Measured

- **Every pristine build failed after `npm ci` had run to its end**, with
  `Cannot find module …/build/server/scripts/fix-node-pty-helper.mjs`. The server package's `postinstall` is
  `node scripts/fix-node-pty-helper.mjs`. A pristine build lays out only the row's install inputs, and the row lists
  `server/package.json` and `server/package-lock.json`, so the script was not in the build tree.
- **So every run ran its own `npm ci`.** A failed key is retried on its backoff and fails again the same way; runs fall
  back to installing in their own copy, which costs time on every run and never changes an answer.
- A hand-kept list in the row would work, but the operator's standing direction is that the product needs no manual
  settings after setup, and the list would go stale the first time a script changed.

## The change

1. **`pristine.ts#lifecycleInputPaths` (L1, pure) decides which paths to look for.** It takes the package's name, its
   `package.json` bytes and the row's declared inputs. It reads the four scripts `npm ci` runs in the package itself
   (`preinstall`, `install`, `postinstall`, `prepare`), in npm's order, splits each into words on whitespace and on
   `&&`, `||`, `;` and `|`, and keeps each word that is a plain path relative to the package: only the characters
   `A-Z a-z 0-9 . _ @ + / -`, so no glob, brace, tilde or assignment; not a flag; no `.`, `..` or empty segment, so no
   absolute path and no escape; and a `/` or a `.` in it, so a bare command word is never looked for. It drops a
   leading `./`, prefixes the package directory, leaves out what the row already declares, de-duplicates, cuts at
   `LIFECYCLE_INPUTS_MAX` (16) in the scripts' order, and sorts. A script with quoting, `$`, a backtick, a backslash,
   redirection, grouping, a background `&` or a second line contributes nothing, and the answer carries a note saying
   so; so does a hook that is not a string, a `scripts` that is not an object, a manifest that is not a JSON object, and
   a row that does not declare the package's `package.json`. Nothing here reads a file.
2. **`mirror.ts#runTreeFiles` (L3) reads the optional paths.** A new `optional` list follows the declared paths. Each is
   listed with `git --literal-pathspecs ls-tree -z <rev> -- <path>` and read only when the tree holds it as a regular
   file (`blob`, mode `100644` or `100755`). Absent, a directory, a link or a submodule is skipped. A listing git
   refuses, a listing it cannot parse, or a file whose bytes do not read back exactly still fails the whole set, as a
   declared input does: absent is skipped, unmeasured never is. The declared paths are read as before.
3. **`service.ts` (L4) composes them.** For each package, `installInputs` reads the declared inputs, hands the
   `package.json` among them to the decider, writes each note once per service on stderr (`ccrc-testbox: <repository>:
   <note>`, through a new optional `log` dependency, as the drain's driver writes its own), reads the derived paths as
   optional, and answers the declared inputs followed by the files found. That one list feeds `seen` (the install
   key) and the store entry whose inputs `buildInstallSpec` writes into `specs/install` and `install-pre` lays out in
   the build tree, so the key and the tree can never disagree. `main.ts` passes the optional list through to the real
   reader.
4. **Explicit row entries keep working.** The row's list is read first, in its order, exactly as before; a derived
   path the row already names is not added twice. A row whose package has no lifecycle scripts gets the same key as
   before this change.

### Why the box derives, not the fleet

The row is composed once, at connect (the connect card's `rowOf`, or a hand-written file under the box's rows), and
says nothing about any particular revision. The scripts, and the files they name, belong to each run's tree: a branch
that adds a `postinstall` or renames its script must key and build with that branch's files. Only the box reads the
run's tree (the mirror at the run's refs), and it already reads the declared inputs there for the key. So the
derivation runs where the key is computed, and the two sides cannot disagree, because the fleet side decides nothing
new: the row it writes is unchanged. Following the ring rules, the decision (which words are paths) is the pure
`lifecycleInputPaths` in L1, the reads (listing and reading blobs) stay in the L3 mirror adapter, and the service, L4,
only sequences them.

### What this does not cover

- A file a lifecycle script reads but does not name on its command line (a module it imports, a config it opens by a
  computed name). The server package's script imports only `node:` modules. Such a file still has to be in the row, as
  before, and its build fails the same visible way until it is.
- A script run by its own path (`./scripts/setup.sh`) needs its execute bit; `install-pre` lays inputs out without
  their modes, so that build fails, as it did before this change, and runs still install in their own copy.
- `git ls-tree` on the git measured here matches its paths by prefix, not as patterns, so `--literal-pathspecs`
  changes nothing measurable today; the test pins the behaviour (a `*` names one literal file) rather than the flag.

## Tests

All in `agent/test/testbox-pristine.test.ts`, each measured red before the fix (against signature-only stubs:
an empty decider and a reader that ignored `optional`):

- `pristine.ts#lifecycleInputPaths`: a `postinstall` that runs `scripts/x.mjs` names `server/scripts/x.mjs`; the four
  hooks and only those, `./` dropped, operators splitting words, de-duplicated and sorted; a declared input is not named
  twice; an unreadable script, hook, `scripts` or manifest adds nothing and says so, and one unreadable hook leaves the
  others read; the cut at `LIFECYCLE_INPUTS_MAX` keeps the first in the scripts' order and says so; and the real
  repository's `server/package.json` derives exactly `server/scripts/fix-node-pty-helper.mjs`, a file in the tree.
  Red: 6 of 7.
- The seventh, "a glob, an absolute path, a `..` path, a flag, an assignment or a bare word adds nothing", passes
  against an empty stub by construction, so it was measured by mutation instead: red with the character check removed
  and red with the segment check removed. An explicit absolute-path check went green under mutation (the empty first
  segment already refuses it), so it was removed rather than kept unmeasured.
- The service, against TB4's fake system manager: a package whose `postinstall` runs `scripts/x.mjs` gets a key that
  includes the file, the install unit's `npm ci` sees it laid out beside the lockfile (and nothing for a missing path
  the script also names), and a change to the file changes the key and builds a second pristine install; a script it
  cannot parse leaves the key as the row declares it and is noted once across two runs. Red: 2 of 2.
- `mirror.ts#runTreeFiles` against a real fixture mirror: an optional regular file is read (mode 644 or 755), an absent
  path, a directory, a link and a pathspec with a `*` are skipped, a literal file named `star*.mjs` is read, a file past
  the capture fails the set, and a declared path that is absent still fails it. Red: 1 of 1; also red with the
  regular-file check removed and red with "absent" read as "unmeasured".

Guards run: the agent typecheck and the touched suites, then `server/`'s `testbox-*`, `single-definition/*`, `rings/*`,
`anchors`, `citations`, `dtbd`, `deviation-refs`, `ci-ledger-guard`, `growth-check`, `growth-caps` and
`shellcheck-ratchet`.

## Deviations found

- **D-8966 (2026-11-23)** — testbox-install-inputs-include-lifecycle-scripts. The box adds to each package's install
  inputs the files its own `preinstall`, `install`, `postinstall` and `prepare` scripts name, read at the run's tree:
  plain relative paths only (no glob, absolute path or `..`), regular files only, at most 16, sorted, after the row's
  own inputs, which still work. A script it cannot parse adds nothing and is noted once on the service's stderr. So the
  install key changes when such a script changes and the pristine build lays the script out; before, every pristine
  build of the server package failed with `Cannot find module …/scripts/fix-node-pty-helper.mjs` and every run ran its
  own `npm ci`. The decision is L1 (`pristine.ts#lifecycleInputPaths`), the read L3 (`mirror.ts#runTreeFiles`'s
  optional paths); the row is unchanged, because only the box reads each run's tree (spec §2.2, §2.6).
