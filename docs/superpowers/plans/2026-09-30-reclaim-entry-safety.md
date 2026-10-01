# Direct reclaim entry safety — Python launcher and privileged Bash boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:executing-plans` to execute this plan and `superpowers:test-driven-development` for every code task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A supported direct `ws-reclaim`, or the direct `ws-audit --session <value> --reclaim [--defer-expired]` token skeleton, reaches the generated Bash body only through a measured Bash >=4.4 privileged-mode boundary established before Bash startup can consume inherited functions, `BASH_ENV`, or shell-option state. A failed or ambiguous boundary refuses before reclaim code runs; the body remains authoritative for validating `<value>` and the complete command grammar.

**Architecture:** Keep `ccd/ccd` as the sourceable generated Bash body. Add a small standard-library-only Python launcher template at `ccd/ccd-entry.py`. Install renders that template to `$HOME/.local/bin/ccd` with an absolute isolated-Python shebang and the SHA-256 of a separate active body at `$HOME/.local/libexec/ccrc/ccd`. The launcher classifies only the two protected argv skeletons, removes Bash startup/function/option variables from the protected probe and payload environment, scans runtime PATH in order for an exact Bash >=4.4 whose `-p` behavior it semantically proves, then `execve`s that same canonical executable with `-p`; ordinary direct verbs use the original environment and the same scanner without privileged mode. The body independently refuses a direct protected argv unless it is actually running under Bash >=4.4 with privileged mode set. Source mode remains sourceable and does not cross the launcher. Runtime PATH and the executables it selects are trusted prerequisites, not identities this feature authenticates.

**Tech Stack:** Python 3 standard library, Bash >=4.4, generated `ccd/ccd`, Vitest (`server/test`, `agent/test`), local installer/update (`ccd/ccrc`), fallback deploy (`deploy/deploy.sh`).

**Programme:** `reclaim-entry-safety`, run 199, wave 1 of 1, coordinated by `ccrc-pwa-calm-mesa`. This is the operator-ruled prerequisite to child-reclamation wave 4; it owns no wave 5 scope. Ledger: `docs/superpowers/programs/reclaim-entry-safety.md`.

**Deviation allocation:** eight numbers were issued once at run-open on 2026-09-30; the first is 3696 and the allocator floor became 3704. This plan defines the first issued number below. Do not render any other issued number as a `D-` token until its own departure is measured and defined here. Unused headroom remains unrendered.

---

## The defect, measured 2026-09-30

- Direct ccd execution currently starts the monolithic Bash file itself (`#!/usr/bin/env bash`). Bash startup therefore occurs before any ccd guard can run. A caller can provide `BASH_ENV`, imported `BASH_FUNC_*` definitions, or inherited option state before line 1 of the body.
- `_ws_reclaim_owned` enumerates registry ownership with external `find`. A hostile inherited function shaped like `find() { [[ "$*" == *.workdir* ]] && return 0; command find "$@"; }` can answer success with no rows at both the evaluation and final ownership measurements. The honest verdict is `containment-unproven`; the poisoned verdict is `reclaimable`, and `ws-reclaim` can remove a live child another registry row still names. That violates child-reclamation contract R31.
- The class is process-wide, not `find`-specific. `git`, `stat`, `tmux`, and other decision-critical commands can be shadowed too. A body-level `unset -f`, `command find`, `set -o posix`, resolver subshell, or `exec bash -p` is too late: `BASH_ENV` already ran and can install readonly functions before the body begins.
- Bash privileged mode is a startup boundary, not privilege elevation. Measured on Linux: ordinary noninteractive Bash consumed `BASH_ENV`, imported `BASH_FUNC_find%%`, and honored inherited `SHELLOPTS`/`BASHOPTS`; `bash -p` did none of those, reported `p` in `$-`, and preserved difficult argv. It does not authenticate PATH-selected executables and it is not a sandbox.
- macOS ships `/bin/bash` 3.2.57 while ccd requires Bash >=4.4. `_svc_job_path` appends `/opt/homebrew/bin` and `/usr/local/bin` after an existing launchd PATH, so selecting the first `bash` by name can choose the unsupported system Bash. Selection has to scan, reject old candidates, and reuse the exact candidate it probed.
- A compiled launcher is not an install-time option: boxes intentionally receive runtime dependencies only and have no compiler requirement, while one release archive supports Linux and macOS. Python 3 is already a product prerequisite, so a standard-library-only Python entry is the existing portable pre-Bash runtime.

## Boundaries and non-claims

- **Protected installed direct entry:** exactly `ws-reclaim` with any tail (the body remains the authority for its full option grammar), and exactly the `ws-audit --session <value> --reclaim [--defer-expired]` token skeleton. The launcher intentionally protects an invalid session-id value before the body rejects it; it does not protect malformed order or an argv merely because a later token says `--reclaim`.
- **Ordinary installed direct entry:** every other argv shape still crosses the Python launcher, selects Bash >=4.4, and starts the same body without `-p`. Preserve its inherited-environment compatibility except where the already-required Bash-floor scan necessarily rejects an unsupported interpreter. Environment sanitization is protected-entry-only.
- **Source mode:** `source ccd/ccd` remains structurally supported, intentionally injectable, and outside the direct-entry guarantee. Existing source-mode fixtures are controls, not proof of installed-entry hardening.
- **Explicit Bash:** `bash ccd/ccd ...` exists in tests and in the wider product, but it bypasses the pre-Bash launcher. A clean explicit invocation of protected argv must fail the body's actual-state check; a hostile `BASH_ENV` executes before line 1, so this plan makes no security guarantee for that invocation path.
- **Detached self-reexec:** an outer `bash -c` that has already started is outside this narrow prerequisite. Do not turn this task into detached swap redesign.
- **Trust boundary:** runtime PATH and the Python/Bash/external executables selected from it are trusted prerequisites. Privileged Bash prevents inherited Bash startup/function/option state from rewriting command resolution; it does not establish provenance for arbitrary programs. A fake PATH Bash or fake external utility is a trust-boundary control, not an attack this feature claims to defeat.
- **Same-user replacement:** the launcher/body digest detects incomplete publication and accidental mismatch. It does not defend against a same-user attacker replacing both files, nor eliminate the hash-to-exec race. Say that in code and tests; do not call the digest authentication.
- **No live mutation:** all destructive tests use fixture HOMEs. Never run `ws-reclaim`, `ws-reap`, `ws-rm`, `ws-gc --prune`, `ws-archive`, or `ws-restore` against the live HOME. The worker does not deploy or manually roll out.

## Settled artifact and startup contract

### Tracked and installed paths

| Role | Path | Contract |
|---|---|---|
| tracked launcher template | `ccd/ccd-entry.py` | standard-library-only Python source with exactly one interpreter placeholder and one body-digest placeholder |
| tracked/source-mode Bash body | `ccd/ccd` | generated, sourceable, independently stamped; never replaced by a non-sourceable wrapper |
| installed direct entry | `$HOME/.local/bin/ccd` | rendered Python launcher, mode 0755 |
| installed active Bash body | `$HOME/.local/libexec/ccrc/ccd` | byte copy of tracked body, mode 0644; invoked only through Bash |
| deployed source tree body | `$HOME/ccrc/ccd/ccd` | source-mode/shipped tree copy; not the active direct-entry body |

The launcher derives the install prefix from its own canonical `/.local/bin/ccd` location and derives `/.local/libexec/ccrc/ccd` from that prefix. It does not trust inherited `HOME` to find the active body. Direct absolute, relative, PATH, and symlink aliases must converge on the same canonical launcher and body. A copied or hard-linked launcher outside the expected installed layout refuses by name rather than guessing a body.

### Python startup boundary

Use a rendered first line of the form:

```python
#!@CCRC_PYTHON3@ -IS
```

The installer resolves one PATH-selected `python3`, canonicalizes it, and semantically probes the exact executable with `-IS` before any publication. The probe must report Python 3 and all four properties: isolated mode, ignored environment, no user site, and no `site` import (`sys.flags.isolated == 1`, `ignore_environment == 1`, `no_user_site == 1`, `no_site == 1`). Render that same canonical absolute path; never probe one interpreter and put bare `python3` in the shebang. Reject a canonical interpreter path containing whitespace or a line break, and reject a complete rendered shebang beyond the conservative length bound proven on both supported kernels. The combined `-IS` spelling is one shebang argument on Linux and Darwin and deliberately disables system `sitecustomize` as well as user/current-directory startup influence. Before either active file moves, execute a rendered staged launcher through its kernel shebang in its final relative layout and require it to report those four flags without entering Bash. Prove that installed-kernel entry on Linux and on a real Darwin runner; an unmeasured Darwin shebang is a named portability gap, not inferred green.

The template has exactly one `@CCRC_PYTHON3@` and one `@CCRC_CCD_SHA256@`. Missing, duplicate, or residual placeholders refuse before an installed artifact moves. Compile the rendered source in memory with Python's `compile`; do not emit bytecode. Run hostile `PYTHONHOME`, `PYTHONPATH`, user-site/current-directory `sitecustomize`, and `PYTHONDONTWRITEBYTECODE` controls through the actual installed kernel entry. The operation creates no `__pycache__`, `.pyc`, or launcher temporary in its staging directory, fixture HOME, or test working directory; it never scans or removes unrelated system caches.

### Launcher algorithm

- [ ] Read `sys.argv[1:]` without decoding/re-encoding through a shell. Preserve empty strings, whitespace, newlines, glob characters, quotes, semicolons, leading hyphens, and undecodable Unix bytes under Python filesystem encoding/surrogateescape semantics.
- [ ] Classify protected argv before starting Bash:
  - `argv[0] == "ws-reclaim"`; or
  - `len(argv) in {4, 5}`, `argv[0:2] == ["ws-audit", "--session"]`, a session-id value occupies `argv[2]`, `argv[3] == "--reclaim"`, and the only optional fifth token is `--defer-expired`.
- [ ] Canonicalize the launcher, derive the active body, inspect that exact directory entry with `os.lstat` (or a non-following equivalent), require a readable regular file that is not a symlink, hash its bytes, and compare with the rendered digest using a constant-time standard-library comparison. Any absence, unreadability, wrong type, symlink, or mismatch refuses before Bash.
- [ ] Split runtime PATH in order. Ignore empty and non-absolute components. For each distinct canonical executable at `<component>/bash`, use that exact path for the probe; continue past absence, execution failure, malformed output, Bash 3.2/4.2/4.3, or a semantic privileged-mode failure.
- [ ] For protected entry only, derive one environment from `os.environ` that preserves trusted `PATH` and ordinary required variables but deletes `BASH_ENV`, `ENV`, `CDPATH`, `SHELLOPTS`, `BASHOPTS`, and every exported-function encoding (`BASH_FUNC_*%%` plus any platform spelling measured by the tests). Use this same sanitized environment for the semantic probe and final payload. Ordinary entry passes its original environment unchanged.
- [ ] Protected probe: execute the candidate with `-p` and a builtin-only command under the protected environment that emits one exact nonce-shaped record only when `BASH_VERSINFO` is >=4.4 and `$-` contains `p`. Capture bounded output and require an exact successful record. Do not use external commands inside the probe.
- [ ] Ordinary probe: establish Bash >=4.4 with a builtin-only command and exact bounded result, without `-p` and without protected-entry sanitization. Do not silently upgrade every verb to privileged mode.
- [ ] Reuse the exact canonical candidate that passed. Final argv is `<bash> -p -- <active-body> <original argv...>` under the protected environment for protected entry and `<bash> -- <active-body> <original argv...>` under the original environment otherwise. Use `os.execve`; never invoke a shell, interpolate argv, or fall back to bare `bash` after the probe.
- [ ] If no candidate proves the required property, refuse with one stable launcher-owned error class and nonzero exit. Distinguish at least: malformed installed layout, body absent/wrong-type/unreadable, body digest mismatch, and no eligible Bash. Never fold any of them into ordinary execution.

### Bash body remeasurement

At the top of `ccd/ccd`, after its generated header and before platform probing or any external command:

- [ ] Classify only the same protected direct argv shapes while `[[ "${BASH_SOURCE[0]}" == "$0" ]]`. Keep the classifier source-local and literal enough for the launcher/body parity test to exercise both directions.
- [ ] For a protected direct shape, require Bash >=4.4 and actual privileged mode (`p` in `$-`). Refuse before `CCD_OS`, `uname`, registry reads, JSON helpers, or dispatch when either is absent.
- [ ] Do not trust an environment marker claiming the launcher ran. No marker authorizes deletion.
- [ ] Source mode does not run this direct-entry guard. A sourced poisoned function must remain observable in the source-mode control.
- [ ] The existing bottom dispatcher still owns command parsing and usage. The new guard does not pre-accept malformed `ws-reclaim` tails; it only establishes the startup boundary before `cmd_ws_reclaim` parses them.

---

## Task 1 — RED: freeze entry grammars, startup attacks, and controls

**Files:** `server/test/ccd-child-reclaim-entry.test.ts` (new unless the worker's merge of current `main` already carries an equivalent dedicated file), `server/test/ccdWsHelpers.ts`, `ccd/ccd-entry.py` only after the first RED is measured.

- [ ] Fetch and merge `origin/main` before choosing the test filename. Never rebase. If main now has `server/test/ccd-child-reclaim-hardening.test.ts`, extend or share helpers with it instead of creating duplicate ownership.
- [ ] Add `CCD_ENTRY` beside the existing `CCD` source constant and a fixture installer that renders the tracked template, installs the body under fixture `$HOME/.local/libexec/ccrc/ccd`, and invokes fixture `$HOME/.local/bin/ccd` directly. It must never inspect or modify live install paths.
- [ ] RED controls and attacks, all against fixture HOMEs:
  - C1 clean direct audit produces its ordinary safe answer.
  - C2 clean direct reclaim reaches the existing safe fixture behavior without deleting a competing live child.
  - C3 source-mode poison remains observable, proving source mode did not silently acquire launcher semantics.
  - C4 representative non-reclaim direct verbs preserve their selected inherited-environment behavior.
  - A1 `BASH_ENV` defines a lying `find`.
  - A2 `BASH_ENV` installs a readonly lying `find`.
  - A3 exported `BASH_FUNC_find%%` lies before startup.
  - A4 a post-token competing `*.workdir` row appears before reclaim ownership remeasurement and survives.
  - T1 a late row appears before the final `_ws_reclaim_owned` measurement and survives.
  - R1 an interrupted `reclaim:worktree` resume with a competing row survives.
  - S1 imported `tmux` lies that an attached session is absent; attached-defer still wins.
  - O1 inherited `SHELLOPTS=xtrace` plus authorization poison cannot authorize protected entry.
  - O2 inherited `BASHOPTS` shopt poison cannot authorize protected entry.
  - O3 hostile `CDPATH` cannot redirect protected measurements.
  - O4 hostile `ENV` cannot steer the protected Bash body.
  - O5 a trusted decision-critical executable implemented as a Bash wrapper starts an ordinary child Bash; protected entry strips startup poison so that child cannot consume inherited `BASH_ENV`/`ENV` or exported functions.
- [ ] Preserve and test the exact audit token skeleton. Malformed order, missing session-value position, duplicate/later `--reclaim`, and extra tokens are ordinary/unprotected classifier results and still die in `cmd_ws_audit`; both reclaim skeletons, including a value the body later rejects as an invalid session id, are protected. A parity table executes the same argv against launcher and body classifiers.
- [ ] For every destructive assertion, compare disk and Git state (workspace, competing row, branch/ref/tombstone as relevant), not only an execution marker or printed verdict.
- [ ] Run the new file on the unfixed tree and record the intended RED rows. Controls that describe legacy behavior must already be green.

## Task 2 — GREEN: implement the isolated Python launcher and body guard

**Files:** `ccd/ccd-entry.py` (new), `ccd/ccd`, `server/test/ccd-child-reclaim-entry.test.ts`, `server/test/ccdWsHelpers.ts`, `server/test/ownership.test.ts`.

- [ ] Implement the settled template, layout derivation, regular-file/digest checks, exact classifiers, PATH scan, semantic Bash probes, exact-candidate `execve`, and stable refusal classes above. Keep it standard-library-only.
- [ ] Add launcher tests for hostile `PYTHONHOME`, hostile `PYTHONPATH`, user/current-directory/system `sitecustomize`, protected-environment stripping versus ordinary-entry preservation, no launcher-owned bytecode/temp leak, and missing/multiple/residual placeholders.
- [ ] Add interpreter tests:
  - B1 the first eligible PATH Bash is selected once and that exact executable is reused;
  - B2 versions below 4.4 are skipped and all-old PATH refuses;
  - B3 the launcher probe passes but a fixture wrapper strips `-p` for the payload; the body refuses before external work;
  - B4 a fixture wrapper strips `-p` for both probe and payload; the launcher refuses before payload;
  - B5 malformed, overlong, duplicate, or failed semantic-probe output refuses;
  - the first PATH Bash may be 3.2 while a later Homebrew-shaped Bash is eligible;
  - no eligible Bash refuses rather than using the Python process's parent shell.
- [ ] Add exact argv round-trip cases and direct absolute, relative, PATH, and symlink entry. Add a copied/hard-linked-outside-layout refusal. Do not claim a guarantee for explicit Bash.
- [ ] Add explicit-Bash controls: a clean `bash ccd/ccd <protected argv>` fails the actual privileged-state check; a forged environment marker grants nothing. State that hostile `BASH_ENV` already ran and is outside the guarantee.
- [ ] Implement the early Bash body guard. Update `ownership.test.ts`'s line-1 prose: `ccd/ccd` keeps its shebang and line-2 generated marker because it remains sourceable and is the active Bash body, not because it is the installed direct entry.
- [ ] Re-stamp `ccd/ccd` after every edit:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
node shared/mark.mjs --check ccd/ccd
```

- [ ] GREEN the Task 1 matrix and existing reclaim audit/verb/ladder/pin suites.

## Task 3 — publish launcher/body as one fail-shut pair

**Files:** `ccd/ccrc`, `deploy/deploy.sh`, `server/test/installTreeFixture.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/install-census.test.ts`, `agent/test/deploy-verify.test.ts`.

### Local install/update lane

- [ ] Add `ccd/ccd-entry.py` to the complete fixture tree census. Do not stub it: installer tests must render the real template.
- [ ] Before `_inst_tree` or another mutating install step, resolve and canonicalize one `python3` from the installer's trusted PATH, reject an unencodable/overlong shebang path, and semantically probe exact `-IS` behavior. A missing/old/malformed interpreter refuses while the old installed pair is untouched.
- [ ] Stage the active body from `$BOX_TREE_DIR/ccd/ccd` to a sibling temporary under `$HOME/.local/libexec/ccrc`, mode 0644; calculate its SHA-256 with an already-probed Python standard-library helper (portable across Linux/macOS, no new `sha256sum` runtime dependency).
- [ ] Render the launcher with the exact canonical Python and staged body digest, validate placeholder census and compile it in memory, stage it beside `$HOME/.local/bin/ccd`, mode 0755, then execute that staged launcher through its kernel shebang in a staged final-layout self-test that reports the required Python flags without entering Bash.
- [ ] Publish body first, launcher last with a pair-specific atomic publisher. Before each rename, inspect the exact destination entry without following it; atomically replace a regular file or symlink-to-file/dangling symlink, and explicitly refuse a directory or symlink-to-directory (never move the staged file inside its target). Verify the postcondition at the exact destination after each rename. First migration is safe because the old self-contained Bash entry remains active while the new body is staged/published. On later updates, an old Python launcher observing a new body digest refuses rather than executing a mixed pair until launcher publication completes.
- [ ] Staging/render/probe failure touches neither active artifact. If body publication succeeds and launcher publication fails, leave the mismatched pair refusing and report convergence retry; do not claim or attempt a transactional rollback across two directories.
- [ ] Remove only installer-owned sibling temporary files on success and retry. Do not broaden cleanup globs into operator files.
- [ ] `_upd_backup` copies both `$HOME/.local/bin/ccd` and `$HOME/.local/libexec/ccrc/ccd` under distinct names before install. Update every “complete backup” assertion and transcript claim. Backup is evidence and a manual recovery source; there is no automatic file rollback today, so do not invent one in prose.
- [ ] `cmd_uninstall` removes both files, removes `$HOME/.local/libexec/ccrc` only if it is empty, and leaves unrelated libexec content. Update install/uninstall source-derived censuses rather than exempting the new path silently.

### Fallback deploy lane

- [ ] Back up both installed artifacts before `rsync --delete` and publication.
- [ ] Render on the destination box with that box's canonical isolated Python; reject an unencodable/overlong shebang path and do not render a server-box interpreter path into a fleet-box launcher. Execute the fully rendered staged launcher through the destination kernel before publication and require the four isolated-Python flags.
- [ ] Stage and publish the body first and launcher last before agent restart or supervisor sweep, using the same non-following destination-type checks and pair-specific replace/refuse publisher as local install. Keep roster-before-ccd and ccd-before-agent ordering. The active body lives outside `$HOME/ccrc`, so the preceding tree rsync cannot tear the running direct-entry pair.
- [ ] Preserve atomic inode replacement for long-running readers. Do not SCP over either active inode, follow a destination symlink, or report success when a staged file was moved inside a symlinked directory.
- [ ] Extend deploy verification to assert the pair, ordering, modes, absolute shebang, digest agreement, and no leftover incoming files.

### Installer tests

- [ ] RED then GREEN: fresh install, converged re-install, migration from old self-contained Bash entry, body-only change, launcher-only render change, body publication interruption, launcher publication interruption, digest mismatch, missing body, wrong body type, unencodable/overlong Python shebang, staged-kernel self-test failure, and retry convergence.
- [ ] For both launcher and body in both install lanes, cover symlink-to-file, dangling symlink, symlink-to-directory, and directory destinations; prove the exact entry is replaced or the lane refuses without mutating a link target.
- [ ] Prove publication ordering and the prepublication kernel self-test with executable hooks/markers, not source prose alone.
- [ ] Prove backup completeness before the first active rename and prove uninstall removes only ccrc-owned artifacts.
- [ ] Preserve existing refusal boundaries: a preflight or staging failure does not create an update backup or move active files unless the existing update contract explicitly takes the backup first. Match current test semantics rather than weakening them.

## Task 4 — refresh capabilities on a measured change to either half and ship both release inputs

**Files:** `agent/src/server.ts`, `agent/test/caps.test.ts`, `deploy/build-release.sh` (pathspec remains `ccd/`), `server/test/build-release.test.ts`, `server/test/macos-platform.test.ts`, relevant source/census tests.

- [ ] Change `VerbCache` from one stat pair to an entry/body pair. Derive the body path once as `$HOME/.local/libexec/ccrc/ccd`; this is a local stat for cache invalidation, not a new wire read or read-whitelist grant.
- [ ] A cache hit requires both entry and body measured `(mtimeMs,size)` pairs to match. If either stat is absent/unreadable, retain prior verbs and the entire prior key. If `ccd caps` fails, retain prior verbs and prior key, so the next request retries. Update the key only after a successful caps read.
- [ ] At boot, retain the existing `readCcdVerbs` behavior but leave both key halves unset so the first live caps request measures and establishes the pair.
- [ ] Add a body-only invalidation test with launcher bytes/stat unchanged. Also isolate entry-only invalidation, missing body after a good read, body stat failure retry, failed caps after one-half change, unchanged pair no re-exec, and same-size/mtime-half controls. Existing single-file cache tests must remain meaningful rather than being deleted.
- [ ] `deploy/build-release.sh` already archives all of `ccd/`; keep that source of truth. Strengthen `build-release.test.ts` so `ccd/ccd` and `ccd/ccd-entry.py` are explicit expected archive members and both are MANIFEST-covered; spot-verify at least the template in addition to the existing independent digest spots.
- [ ] Update install census tracked-source coverage for the launcher template and the libexec body placement. If its current extractor intentionally sees only `$HOME/.local/bin`, add a separate derived assertion for the libexec placement/removal pair rather than teaching it to silently drop that directory.
- [ ] Update the byte-identical platform-layer assertion's prose and inputs: the generated Bash body still carries the shared platform block; the Python launcher does not duplicate it.

## Task 5 — portability and supported-entry evidence

**Files:** `server/test/macos-platform.test.ts`, `server/test/ccd-child-reclaim-entry.test.ts`, `agent/test/deploy-verify.test.ts`, service/plist fixture tests as needed.

- [ ] Linux fixture evidence crosses the installed direct entry from local server `execFile`, remote agent `execFile`, and the systemd `ExecStart=%h/.local/bin/ccd ...` shape.
- [ ] Darwin fixture evidence crosses the launchd ProgramArguments installed direct entry. Force PATH `/usr/bin:/bin:/usr/sbin:/sbin:<later-homebrew-bin>` with a Bash-3.2-shaped first candidate and eligible later candidate; prove the later one wins and the exact candidate is reused.
- [ ] On a real Darwin CI runner, execute the rendered absolute `-IS` shebang through the kernel, record `sys.flags`, prove hostile Python startup paths are ignored, and run the protected-entry matrix that does not depend on Linux-only service machinery. macOS CI is non-gating by operator ruling; report exact job/test evidence or name it unmeasured without blocking the Linux acceptance.
- [ ] Add fail-shut external-command rows: a trusted PATH `find` that exits nonzero remains unmeasured, never empty; a second decision-critical command failure refuses. Fake PATH executables remain clearly labelled trust-boundary controls.
- [ ] Run source-mode suites to prove the split did not break direct sourcing, and direct-entry suites to prove no supported production path bypasses the launcher.

## Task 6 — mutation table, gates, merge main, and PR

**Files:** all above plus this plan if a measured departure is defined.

- [ ] Measure each mutation RED against a named GREEN control, restore it, and re-stamp when `ccd/ccd` changed:

| Mutation | Required discriminator |
|---|---|
| delete protected `ws-reclaim` classifier arm | imported-function direct reclaim attack reaches/changes protected behavior; clean control stays meaningful |
| delete protected valid audit arm | valid direct audit attack reds |
| broaden protection to every direct verb | ordinary direct compatibility control reds |
| protect any audit containing a later `--reclaim` | malformed-audit grammar/parity row reds |
| remove `-p` from payload | body privileged-state remeasurement reds |
| remove Bash >=4.4 launcher check | old-first/all-old interpreter rows red |
| remove semantic privileged-mode probe | stripped-`-p` probe row reds |
| remove body privileged-state remeasurement | probe-pass/payload-strip row reds |
| trust inherited “hardened” marker | forged-marker explicit-Bash row reds |
| probe one Bash, invoke bare `bash` later | exact-candidate-reuse row reds |
| fold probe failure into ordinary execution | malformed/failing probe row reds |
| treat failed registry enumeration as empty | external-find-failure disk-state row reds |
| remove final `_ws_reclaim_owned` remeasurement | late competing-row disk-state row reds |
| route source mode through launcher | sourced-poison control reds |
| omit launcher or body from install/deploy/release | placement, deploy, and archive/MANIFEST controls red |
| edit `ccd/ccd` without re-stamping | ownership/stamp gate reds |
| let Darwin silently choose `/bin/bash` 3.2 | old-first/later-eligible Darwin row reds |
| key agent cache only to launcher | body-only caps invalidation reds |
| remove/corrupt `-IS` shebang flags | installed-kernel Python flags/startup-poison rows red |
| remove launcher/body digest pairing | mixed-publication mismatch row reds |
| pass the inherited environment to protected probe or payload | trusted Bash-wrapper child-startup poison row reds |
| follow body metadata through a symlink | runtime body-symlink row reds |
| publish through a symlink-to-directory with generic `mv -f` | exact-destination postcondition row reds |
| omit the staged kernel-entry self-test or accept an unencodable shebang | unlaunchable-entry install/deploy row reds |

- [ ] Run `git diff --check` and Bash/Python syntax checks.
- [ ] Run from `server/`, foreground, timeout >=600000 ms:

```bash
./node_modules/.bin/vitest run \
  test/ccd-child-reclaim-entry.test.ts \
  test/ccd-child-reclaim-audit.test.ts \
  test/ccd-child-reclaim-verb.test.ts \
  test/ccd-child-reclaim-ladder.test.ts \
  test/ccd-child-reclaim-pin.test.ts \
  test/ccrc-install.test.ts \
  test/ccrc-update.test.ts \
  test/ccrc-uninstall.test.ts \
  test/install-census.test.ts \
  test/build-release.test.ts \
  test/ownership.test.ts \
  test/macos-platform.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
./node_modules/.bin/vitest run test/deviation-refs.test.ts test/ledger-crosstree.test.ts test/dtbd.test.ts
```

  If the dedicated entry filename changed because main already owns an equivalent suite, substitute the actual file and report it. Run every additional repo-wide guard selected by changed-file CI; touched-file-only suites are insufficient.
- [ ] Run from `agent/`, foreground, timeout >=600000 ms:

```bash
./node_modules/.bin/vitest run test/caps.test.ts test/deploy-verify.test.ts
npm run build
```

- [ ] Run `node shared/mark.mjs --check ccd/ccd` and the real S6-R11 selector after the final merge/stamp. Report stated/base/tree citation counts.
- [ ] Fetch and merge current `origin/main` after implementation, never rebase. Resolve `ccd/ccd` by applying both bodies and regenerating the stamp, never by taking one side wholesale. Re-run every gate affected by the merge.
- [ ] Commit on this workspace's own branch, never a separate feature branch. Open one prerequisite PR against `main`; do not merge and do not deploy. Its body reports the defect, exact protected grammar, Python/Bash trust boundaries, publication semantics, mutation results, Linux evidence, honest Darwin status, capability-cache treatment, tests, and deviations.
- [ ] Send wave-done only after push and PR-open. Name the exact handoff commit, branch, clean status, PR/head, all four machine-readable items, every test result, mutation table, generated stamp, deviations, and remaining CI. Do not wait on CI by sleeping.

## Exact machine-readable work items

These four strings are authoritative. Dispatch and wave-done use them byte-for-byte, without terminal punctuation:

1. `Install the argv-selective privileged Bash boundary for direct reclaim entry`
2. `Pin hostile inherited environments across every supported reclaim entry path`
3. `Prove fail-shut reclaim behavior with second-command and authorization mutations`
4. `Merge current main, run the required gates, and open the prerequisite PR`

## Explicit exclusions

- Wave 5 reclaim chip.
- R25/R36 orphan temp-root collection.
- Wave 5 attention-list questions.
- Unrelated Wave 4 fixes.
- Detached swap self-reexec.
- Deployment or live fleet mutation by the worker.
- Whole-ccd privileged-mode conversion.
- Resistance to arbitrary executable PATH poisoning.
- Manual rollout.

## Deviations found

Numbers are issued, never chosen. This run's coordinator allocated its block once at run-open. A worker never calls the allocator. Define an issued number here only after measuring the departure, and never spell the unused block as a range of `D-` tokens.

- **D-3696** (`ccd-imported-functions-hijack-reclaim-reads`) — Direct `ws-reclaim` and the direct `ws-audit --session <value> --reclaim [--defer-expired]` token skeleton currently enter ccd through ordinary Bash startup. Imported functions or startup state can shadow decision-critical commands such as `find`, make registry ownership enumeration falsely succeed empty, and change R31's honest `containment-unproven` into `reclaimable`, allowing unattended deletion of a live child another row names. Call-site hardening cannot establish the missing precondition because `BASH_ENV` and imported readonly functions execute before the body. This plan adds an argv-selective pre-Bash Python launcher, strips Bash startup/function/option variables from the protected probe and payload environment, proves and reuses an exact PATH-selected Bash >=4.4 in privileged mode for those direct shapes, and requires the Bash body to remeasure actual privileged state before destructive work. Runtime PATH and every executable selected from it remain trusted prerequisites; privileged Bash does not authenticate them. Measured by the coordinator on 2026-09-30 from Wave 4 Fix Round 3's unresolved process-entry class; tightened on 2026-10-01 after adversarial plan review measured that `bash -p` suppresses its own startup processing but otherwise retains the hostile variables for an ordinary child Bash.
- **D-3697** (`shellopts-privileged-forges-dash-p`) — Measured by the worker on 2026-10-01 (bash 5.2.21, Linux): a plain `bash` that imports `SHELLOPTS=privileged` from its environment reports `p` in `$-` (and skips `BASH_ENV`) while still importing every exported `BASH_FUNC_*` function. The body remeasurement as written — "actually running under Bash >=4.4 with privileged mode set" — reads `p` from `$-`, so it alone is satisfied by an unprivileged start that carries imported functions: an explicit `bash ccd/ccd` invocation, or any start whose environment escaped the launcher's protected sanitization. Departure, a stricter body refusal than the plan states: a protected direct shape also refuses when any shell function is already defined at the guard (`declare -F` non-empty, refusal class `entry-imported-functions`) — at that line ccd has defined none, so any function present came in with startup. Pinned by `server/test/ccd-child-reclaim-entry.test.ts` ("an explicit bash that imports SHELLOPTS=privileged reports p — and still refuses"). No guarantee is added for explicit Bash: a hostile `BASH_ENV` still runs before line 1 whenever `SHELLOPTS` does not suppress it.
- **D-3698** (`canonical-python-shebang-strands-on-upgrade`) — Measured by the worker's final whole-branch review on 2026-10-01: the canonical interpreter path the plan renders is version-specific (`/usr/bin/python3.12` on this box; `…/Cellar/python@3.12/3.12.x/…` under Homebrew), and an Ubuntu release upgrade or a `brew upgrade`/cleanup deletes exactly that file, after which every ccd start — supervisors, agent exec, server reclaims — fails `bad interpreter` with nothing to heal it until an install is re-run. Ruled by the coordinator (ask answered 2026-10-01, "PATH path if same binary"). Departure from "Render that same canonical absolute path": the shebang names the first `python3` on PATH, spelled as PATH spells it, when it resolves to the very interpreter that answered the `-IS` probe (so an upgrade that repoints that path moves the launcher with it), and the canonical path otherwise (a shim script, another interpreter). The same whitespace/line-break and 127-byte checks and the same staged kernel self-test apply to the chosen path. Pinned by `server/test/ccd-entry-install.test.ts` ("the shebang names the PATH-selected python3 when it is the very interpreter probed, else the canonical one").
- **D-3699** (`symlinked-dot-local-defeats-canonical-layout`) — Measured by the worker's final whole-branch review on 2026-10-01: with `~/.local` or `~/.local/bin` itself a symlink, the launcher's canonical path no longer ends in `/.local/bin/ccd`, so the plan's layout rule refused every start (`entry-layout`) after an install that reported success, and the staged self-test (run under `~/.local/.ccd-selftest.*`, whose canonical path still carries the layout) could not see it. Departure from "derives the install prefix from its own canonical `/.local/bin/ccd` location": the launcher derives the body from its canonical path when that carries the layout and otherwise from the path the kernel was handed; a copy or hard link outside the layout still refuses, and the body must still match the rendered digest whichever path named it. The publisher asks the same question of the final destination before anything moves and refuses (exit 1) a layout whose launcher would look for a different body — e.g. a `~/.local/bin` that resolves into another `.local/bin`. Pinned by `server/test/ccd-child-reclaim-entry.test.ts` and `server/test/ccd-entry-install.test.ts` (the D-3699 rows).
- **D-3700** (`bash-p-honours-more-inherited-variables`) — Measured by the worker on 2026-10-01 (bash 5.2.21), following the final review's report of `POSIXLY_CORRECT` and `BASH_COMPAT`: `bash -p` still honours, from the environment, `POSIXLY_CORRECT` (posix mode on), `BASH_COMPAT` (a compat level), `TMOUT` (`TMOUT=1` makes `while read … < <(sleep 2; echo row)` read zero rows — a truncated enumeration, the fail-open shape), `FUNCNEST` (aborts the script mid-act), `SECONDS` (rebases the clock) and `BASH_XTRACEFD`; `IFS`, `OPTIND`, `OPTERR` and `BASH_ARGV0` are reset and stay so. Departure from the protected environment's listed deletions: the launcher also removes `POSIXLY_CORRECT`, `BASH_COMPAT`, `TMOUT`, `FUNCNEST`, `SECONDS`, `BASH_XTRACEFD`, `EXECIGNORE`, `GLOBSORT` and `BASH_LOADABLES_PATH` (with `GLOBIGNORE`, ledgered as a ruling) from a protected start's probe and payload; an ordinary start keeps all of them. Pinned by `server/test/ccd-child-reclaim-entry.test.ts` ("a protected payload's environment … carries none of it"). Locale variables and tool-specific variables (`GIT_*`, `PYTHON*`) remain outside this boundary and are not claimed.

---

## Wave-done and official review

The worker's report is a claim. The coordinator remeasures the exact branch tip, clean state, PR head/state, generated marker, tests, deviation definitions, and machine-readable items, then submits that exact fingerprint to run 199. Items settle only after the server accepts the same fingerprint.

Official acceptance comes from a distinct `kind:"review"` run in its own worktree reading the one server-accepted tip. It runs the standard held-out panel literally: Opus/high correctness, specification-conformance, and reproducibility lenses; three Sonnet/high refuters per finding; majority rules. Add one independent Opus/xhigh destructive SAFETY lens over process entry, inherited startup state, mixed publication, R31 ownership remeasurement, attached-defer, and disk-state mutation evidence. A dead or empty lens is unverified, never approval. The coordinator does not substitute its own code reading.

If the review accepts, merge with the exact head guard and admin bypass, never deleting the branch. Observe release creation and automatic updater convergence read-only. No session manually rolls out. Only after the prerequisite is live may Wave 4's `swift-hollow` child merge `origin/main`, regenerate/re-stamp `ccd/ccd`, produce a new exact handoff, and enter official Wave 4 review.
