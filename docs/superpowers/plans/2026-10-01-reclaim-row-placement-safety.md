# Alternate-row reclaim placement proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:executing-plans` to execute this plan and `superpowers:test-driven-development` for every code task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make destructive child-workspace reclaim treat an alternate registry row resolved only by absent-suffix textual projection as unmeasured, without changing the subject child's deliberate vanished-worktree behavior.

**Architecture:** Port only the final logical resolver substrate from immutable Wave 4 source `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08` onto current `origin/main`, because current main has the reclaim ladder and ownership seams but not that resolver. Extend the resolver's global result with an explicit `complete|absent-suffix|unmeasured` basis, then let `_ws_reclaim_workdir_shared` authorize physical comparison for alternate rows only on `complete`; the existing ladder, locked recomputation, and `_ws_reclaim_owned` fresh/resumed calls all consume that one helper. Literal containment remains independently authoritative, and the subject path still uses its existing R19 absent-worktree arm.

**Tech Stack:** generated Bash (`ccd/ccd`), Node.js 22.13+, TypeScript, Vitest, Git fixture worktrees, fixture-only tmux/service models.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`

**Programme:** `reclaim-row-placement-safety`, run 208, wave 1 of 1, coordinated by `ccrc-pwa-calm-mesa`. It lands before `reclaim-entry-safety` run 199 and child-reclamation Wave 4. Ledger: `docs/superpowers/programs/reclaim-row-placement-safety.md`.

**Deviation allocation:** sixteen numbers were issued once at run-open on 2026-10-01; the first is 3731 and the allocator floor became 3747. This plan defined the first issued number at handoff; each later measured departure defines the next issued number in order, in "Deviations found" below. Do not render any other issued number as a `D-` token until its own measured departure is defined here. Unused headroom remains unrendered.

**Immutable plan handoff:** the dispatch brief supplies the full coordinator handoff commit as the concrete `HANDOFF_SHA` value. This fresh child starts from `origin/main`, where this coordinator-only plan does not yet exist. Before any implementation, copy exactly `docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md` from that `HANDOFF_SHA` with read-only `git show`, verify its blob ID and bytes against that commit, and commit the plan alone as this branch's first commit. Do not cherry-pick or merge coordinator ancestry. The concrete commands are Task 0.

## Global Constraints

- Fixture HOMEs only. Never invoke `ws-reclaim`, `ws-reap`, `ws-rm`, `ws-gc --prune`, `ws-archive`, `ws-restore`, or `ws-reclaim`'s internal destructive path against the live HOME.
- One child opens one PR. Commit on the child's own workspace branch, never a separate feature branch.
- Start from current `origin/main`. Merge current `origin/main` before handoff, never rebase.
- Current `origin/main` has `_ws_reclaim_workdir_shared`, `_ws_reclaim_eval`, `_ws_reclaim_locked`, `_ws_reclaim_owned`, both tail arms, R19, token semantics, and `--defer-expired`, but lacks `_WS_RESOLVED`, `_ws_reclaim_resolve`, and `_ws_reclaim_resolvable`.
- Immutable `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08` is source material only. Extract final resolver/helper bodies and focused behavioral cases with `git show`; do not cherry-pick it, import its whole diff, restore its historical hardening suite, or absorb unrelated Wave 4 behavior.
- `ccd/ccd` is generated. Re-stamp every edit, preserve the shebang on line 1 and generated marker on line 2, and keep the file sourceable.
- L0/shared rules are unchanged; no wire field, protocol bump, dependency, process-table reader, `/proc`, libproc, `lsof`, real tmux, or platform-specific authorization branch is added.
- `pane_current_path`, process-retained cwd, and modeled tmux liveness are observations, never deletion consent. An absent-suffix alternate row refuses identically when modeled live, gone, or unknown.
- Diagnostics name alternate row IDs only. Never print the alternate row's raw `.workdir`, symlink spelling, suffix, control characters, or newline payload.
- Preserve R19's own arm: the subject child's proven-absent worktree with no reclaim breadcrumb remains reclaimable and follows the existing absent-worktree pin/tombstone/tail path whenever every other row is placed. An ambiguous alternate row holds a vanished subject as it holds a present one, and two vanished children hold each other (qualified from "Preserve R19 exactly", as recorded in D-3734).
- Preserve outcome vocabulary: alternate-row placement ambiguity returns the existing retryable `unmeasured` answer; it adds no refusal token and no terminal audit journal row.
- Preserve precedence: independently proven literal same/nested/through containment still produces `containment-unproven`, even if physical resolution is incomplete. Unknown, empty, failed, unreadable, or future resolver bases never authorize physical comparison.
- Every guard ships with a mutation that turns a named green control red before restoration. Disk/Git state proves destructive safety; a verdict-only test is insufficient.
- Run suites in the foreground with timeout at least 600000 ms. Re-run a known load flake in isolation before attribution, and compare an unexplained red against untouched current main.
- Deployment and rollout are out of scope. After merge, the coordinator observes release creation and automatic updater convergence read-only.

## File Structure

- `ccd/ccd` — generated Bash implementation: selectively ports the immutable logical resolver, exports its proof basis, and keeps the one cross-row placement policy consumed by audit, locked recomputation, and final ownership.
- `server/test/ccd-child-reclaim-ladder.test.ts` — direct resolver/basis, literal/physical precedence, subject-R19, and recovery controls.
- `server/test/ccd-child-reclaim-audit.test.ts` — audit verdict, token/journal absence, and diagnostic privacy.
- `server/test/ccd-child-reclaim-verb.test.ts` — locked, fresh-final, resumed-final, deferred, liveness, seam-sentinel, and byte-level no-mutation evidence.
- `docs/superpowers/programs/child-reclamation-contract.md` — durable R19/R31 contract.
- `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` — design explanation beside §5.5/§5.7.
- `docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md` — immutable implementation artifact and issued deviation definition.
- `README.md` and `server/test/session-hook.test.ts` — modified only where S6-R11 proves a generated-file insertion moved a frozen citation or its exact census.

## Review Focus

- **Removed ancestor alias, direct spelling:** an alternate session entered the child through an ancestor symlink, the link is removed, and its row now resolves only as projected text; audit, locked recomputation, and final ownership must all stop without mutation.
- **Removed ancestor alias reached through real `..`:** the final logical resolver must preserve where a logical entry landed, but if its remaining suffix begins only after proven absence, that answer still cannot authorize alternate-row non-containment.
- **Liveness-independent authority:** modeled live, gone, permission-denied, no-server, and no-socket states all leave the same target tree, branch, alternate row, pane model, and unit-call record untouched.
- **Literal-versus-physical precedence:** literal same/nested/through rows stay terminal `containment-unproven`; only a fully resolved existing outside row is non-blocking, and a fully resolved existing inside row is refused.
- **Recovery and subject asymmetry:** removing the ambiguous row restores ordinary behavior, while a vanished subject child remains reclaimable under R19 once every other row is placed (D-3734). Re-pointing the alias to a complete outside path also reclaims, but that is the pre-existing re-point class, not a recovery (D-3735).

---

## Measured defect and source provenance

At coordinator planning time:

- coordinator handoff base is `9940a9fdd4d90c86d8ddbc420a0a8068698a25b9`;
- measured `origin/main` is `5b1c58a89ac221b4e5e837588169cd710f3cf601`;
- resolver-bearing immutable source is `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08`;
- current main and the coordinator branch contain no `_WS_RESOLVED`, `_ws_reclaim_resolve`, or `_ws_reclaim_resolvable` symbol;
- the Wave 4 source diff is broad and incremental: its `ccd/ccd` and test history include unrelated resolver rounds, split suites, and product work. It is not a safe cherry-pick or merge source.

The final resolver at `1a02baac7` walks the longest currently existing directory prefix, enters that prefix logically and obtains its physical path, rejects unresolved `..`, proves the first missing component absent, and textually reconstructs the suffix. It returns rc 0 and `_WS_RESOLVED=<path>` for both:

1. a complete path whose current spelling was walked through existing directories; and
2. a path whose suffix was reconstructed only below a proven-absent component.

That single success shape is insufficient at a destructive cross-row seam. A process may have entered through a symlink while it existed and retain the physical child cwd after the namespace alias is removed. The row's current spelling then yields an apparently canonical outside projection even though it is not evidence of where that session remains. The existing resolver-era consumer sets `rok=1` on any rc-0 answer and may compare that projected path as if it proved non-containment. Audit can mint a token, locked recomputation can accept it, and `_ws_reclaim_owned` can repeat the same false-safe result immediately before removal.

The repair is deliberately consumer-qualified rather than global. The resolver exports how it formed the answer. Alternate rows require `complete`; the subject child's existing missing-path behavior remains governed by R19.

## Exact result and consumer contract

`ccd/ccd` produces these globals from one resolver call:

```text
_WS_RESOLVED=<canonical or projected path, when available>
_WS_RESOLVE_BASIS=complete|absent-suffix|unmeasured
```

`_ws_reclaim_resolve <path>` has this exact contract:

| Return | `_WS_RESOLVED` | `_WS_RESOLVE_BASIS` | Meaning |
|---|---|---|---|
| 0 | non-empty canonical path | `complete` | the complete current spelling was entered through existing directories |
| 0 | non-empty projected path | `absent-suffix` | the first unresolved component was proven absent, then the remaining components were reattached textually |
| nonzero | empty | `unmeasured` | control character, unreadable/unenterable path, unresolved `..`, failed absence proof, malformed/empty result, or any other failure |

On every call, initialize both globals before reading input:

```bash
_WS_RESOLVED=''
_WS_RESOLVE_BASIS='unmeasured'
```

Set `complete` only at the empty-rest success. Set `absent-suffix` only after `_ws_reclaim_absent` proves the first missing component and the projected result is assembled. A recursive call for a logically entered prefix returns its own globals unchanged; no caller relabels the recursive result.

`_ws_reclaim_workdir_shared <subject-id> <subject-workdir>` remains the only cross-row placement reader. For each alternate row, the same resolver call supplies `wr` and `basis`. The authorization matrix is:

```text
alternate + complete       -> physical comparison may run
alternate + absent-suffix  -> collect as unmeasured
alternate + unmeasured     -> collect as unmeasured
alternate + empty/unknown  -> collect as unmeasured
subject + absent-suffix    -> do not globally refuse; preserve the existing R19 path
```

Literal checks remain independent and earlier in authority. An alternate row literally equal to or beneath the child still enters `_WS_SHARED_ROWS`, `_WS_NESTED_ROWS`, or `_WS_THROUGH_ROWS` and yields terminal `containment-unproven`; basis ambiguity must not downgrade it to retryable `unmeasured`. For a non-literal alternate row, only `basis == complete`, a non-empty `wr`, and a resolvable subject permit physical comparison. Collect every other basis under the helper's existing unmeasured/not-placed mechanism, naming only row IDs.

No call site gains liveness input. Existing calls already cover all destructive seams:

- `_ws_reclaim_eval` invokes the helper during audit/evaluation;
- `_ws_reclaim_locked` recomputes the ladder under the lock before accepting `--expect`;
- `_ws_reclaim_owned` invokes the helper at final removal on both fresh and resumed tail paths;
- `--defer-expired` changes the fingerprint/defer decision but does not skip ownership evaluation.

Do not copy unrelated call-site hunks from `1a02baac7`. If implementation discovers a current-main call site that bypasses `_ws_reclaim_workdir_shared`, stop, record it as a measured departure using an issued slot, and add a direct test before changing it.

---

### Task 0 — Materialize and commit the immutable plan blob

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Create from the dispatched commit blob: `docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md`

**Interfaces:**
- Consumes: the dispatch brief's concrete full `HANDOFF_SHA` value and this exact plan path.
- Produces: one verified plan-only first commit on the fresh child's workspace branch; later tasks read that tracked artifact.

- [ ] **Step 1: Prove the child starts from main and the plan is absent.** From repository root, before any code edit:

```bash
git status --short
git merge-base --is-ancestor origin/main HEAD
test ! -e docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md
```

Expected: clean status, the ancestry check exits 0, and the absence check exits 0. If the path already exists, stop and report rather than overwrite it.

- [ ] **Step 2: Copy only the exact dispatched blob.** Export the concrete full SHA named in the brief as `HANDOFF_SHA`; do not abbreviate it and do not substitute another branch tip:

```bash
test "${HANDOFF_SHA:-}" != ''
test "${#HANDOFF_SHA}" -eq 40
PLAN='docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md'
git cat-file -e "$HANDOFF_SHA^{commit}"
git show "$HANDOFF_SHA:$PLAN" > "$PLAN"
```

This is a read-only source operation. Do not cherry-pick, merge, or otherwise import the coordinator commit.

- [ ] **Step 3: Verify blob identity and byte equality.** The worktree file's Git blob ID must equal the blob named by the immutable commit:

```bash
expected=$(git rev-parse "$HANDOFF_SHA:$PLAN")
actual=$(git hash-object "$PLAN")
printf 'expected=%s\nactual=%s\n' "$expected" "$actual"
test "$actual" = "$expected"
git diff --no-index -- /dev/null "$PLAN" >/dev/null || test "$?" -eq 1
git status --short
```

Expected: `expected` equals `actual`; status shows only `?? docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md`. The `git diff --no-index` rc 1 means the new file has content, not that verification failed.

- [ ] **Step 4: Commit the plan alone as the branch's first child commit.** Verify the staged path census before committing:

```bash
git add "$PLAN"
test "$(git diff --cached --name-only)" = "$PLAN"
git commit -m "docs(reclaim): import row placement safety plan

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git diff --quiet HEAD "$HANDOFF_SHA" -- "$PLAN"
```

Expected: the plan-only commit succeeds, and the final command exits 0 because the child's new `HEAD` carries the exact handoff blob. Record the commit in the task notes. No production or test file may be part of this first commit.

---

### Task 1 — Port the final logical resolver substrate with focused RED/GREEN evidence

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Modify: `ccd/ccd`
- Modify: `server/test/ccd-child-reclaim-ladder.test.ts`
- Test: `server/test/ccd-child-reclaim-ladder.test.ts`

**Interfaces:**
- Consumes: current-main `_ws_reclaim_absent <path>`, `_reg_read <id> workdir`, `_ws_reclaim_plain_path <path>`, and `_ws_reclaim_workdir_shared <id> <workdir>`.
- Produces: `_WS_RESOLVED`, `_ws_reclaim_resolve <path>`, `_ws_reclaim_resolvable <path>`, and a resolver-backed `_ws_reclaim_workdir_shared` whose path and resolvability come from the same call. Task 2 extends the result with `_WS_RESOLVE_BASIS`.

- [ ] **Step 1: Freeze the immutable source slice without importing ancestry.** From repository root, inspect only the final bodies and their comments:

```bash
SOURCE=1a02baac7abfbb1a88a1a7a251c7326c11ae9f08
for symbol in _ws_reclaim_workdir_shared _ws_reclaim_resolve _ws_reclaim_resolvable; do
  git show "$SOURCE:ccd/ccd" | SYMBOL="$symbol" perl -0777 -ne \
    'my $s=$ENV{"SYMBOL"}; /(^\Q$s\E\(\).*?^\})/ms or die "missing $s\n"; print "$1\n"'
done
```

Each loop iteration must print one complete function through its closing brace; an empty or partial body is a stop. Also inspect the declaration immediately before the placement helper and the resolver result declaration:

```bash
git show "$SOURCE:ccd/ccd" | rg -n -B1 '^_ws_reclaim_workdir_shared\(\)|^_WS_RESOLVED='
```

Record all three complete function bodies plus both declarations in the task notes, that `git show` is the source, and that no cherry-pick occurred. Diff candidate helper bodies by content, not historical line number. Do not import `/proc` policy, unrelated Wave 4 call sites, tail changes, split test files, or historical `server/test/ccd-child-reclaim-hardening.test.ts` wholesale.

- [ ] **Step 2: Write focused resolver-port tests before copying implementation.** In the existing ladder suite, add direct fixture-HOME cases that source `ccd/ccd` and assert the final resolver behavior needed by placement:
  - an existing path through a symlinked ancestor resolves to the physical path;
  - an existing logical path containing `..` resolves where Bash logical entry lands, not by textual normalization;
  - a suffix below a proven-absent component returns a canonical projected string;
  - an unresolved suffix containing a real `..` component fails;
  - a logically entered `..` prefix that cannot be walked fails rather than falling back to the kernel spelling;
  - a control-character or newline spelling fails with an empty result;
  - an unreadable/non-directory interruption fails rather than looking absent;
  - the path and success verdict come from one call, with imported `cd`, `pwd`, `printf`, `builtin`, `set`, physical-shell state, and `CDPATH` unable to steer the entry logic covered by the final immutable helper.

Use string concatenation for spellings containing `..`; `path.join` would normalize away the input under test. Name the immutable commit in test comments only where it explains the port boundary, not as a runtime dependency.

- [ ] **Step 3: Run the focused selector on current main and record RED.** From `server/`:

```bash
./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts \
  -t 'logical resolver|removed ancestor alias|unresolved suffix|logical entry'
```

Expected before implementation: FAIL because `_ws_reclaim_resolve`/`_WS_RESOLVED` do not exist or because current `_ws_realpath` fallback accepts a placement the final logical resolver refuses. Existing placement controls remain green.

- [ ] **Step 4: Port the minimal final resolver substrate.** In `ccd/ccd`, transplant by content from immutable `1a02baac7`:
  1. `_WS_RESOLVED='';`
  2. `_ws_reclaim_resolve()`;
  3. `_ws_reclaim_resolvable()`;
  4. only the resolver-backed portions of `_ws_reclaim_workdir_shared` needed so every subject/alternate `wr` and its success verdict come from the same `_ws_reclaim_resolve` call.

Keep current-main `_ws_reclaim_eval`, `_ws_reclaim_eval_absent`, `_ws_reclaim_locked`, `_ws_reclaim_owned`, `_ws_reclaim_tail`, `_ws_reclaim_fork`, `cmd_ws_reclaim`, token fields, and `--defer-expired` behavior. Reconcile comments to current source; do not copy a stale line anchor or claim a source counterpart outside generated `ccd/ccd`.

- [ ] **Step 5: Re-stamp and verify generated/sourceable shape.** From repository root:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
node shared/mark.mjs --check ccd/ccd
bash -n ccd/ccd
bash -c 'source ccd/ccd; declare -F _ws_reclaim_resolve _ws_reclaim_resolvable _ws_reclaim_workdir_shared >/dev/null'
```

Expected: all pass; line 1 is the shebang and line 2 is `# ccrc:generated 1 sha256=<64 lowercase hex digits>`.

- [ ] **Step 6: Run GREEN and placement regressions.** From `server/`:

```bash
./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts
```

Expected: PASS. If the selective port requires editing a current-main call site beyond `_ws_reclaim_workdir_shared`, stop and justify that hunk with a failing behavior test rather than copying it opportunistically.

- [ ] **Step 7: Pay S6-R11 in this same ccd task.** From `server/`, run both exact selectors before this task commits:

```bash
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
```

Expected: both PASS after repairing every affected citation/census by current content. Locate each moved citation by the bytes its sentence names, never by adding a line delta. Remeasure citation-debt maps, `README` anchors, `**Files:**` location indexes, `|`-row sets, and range bounds; edit `README.md` and/or `server/test/session-hook.test.ts` only where the selectors prove this task moved them. Re-run both selectors after repair. If this task adds an `_reg_get` call, also run `./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts`; none is expected.

- [ ] **Step 8: Commit the independently reviewable port.** From repository root:

```bash
git add ccd/ccd server/test/ccd-child-reclaim-ladder.test.ts
git add README.md server/test/session-hook.test.ts  # omit each unchanged path
git commit -m "fix(reclaim): port final logical row resolver

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2 — RED/GREEN the proof basis and complete-only alternate-row authorization

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Modify: `ccd/ccd`
- Modify: `server/test/ccd-child-reclaim-ladder.test.ts`
- Modify: `server/test/ccd-child-reclaim-audit.test.ts`
- Test: all three files above

**Interfaces:**
- Consumes: Task 1's `_ws_reclaim_resolve` and `_ws_reclaim_workdir_shared`; current `evalOf`, `makeChild`, `plantTmux`, `TMUX_FAULTS`, lifecycle journal readers, and registry fixture helpers.
- Produces: `_WS_RESOLVE_BASIS=complete|absent-suffix|unmeasured`; alternate-row physical comparison authorized only for `complete`; audit/evaluation ambiguity returns exit 1, `verdict:"unmeasured"`, no token, and no terminal journal row; all Task 3 seam tests turn GREEN when this task's shared guard lands.

- [ ] **Step 1: Add direct resolver-basis RED tests.** Extend the ladder suite with a table that calls `_ws_reclaim_resolve` once and prints rc, `_WS_RESOLVED`, and `_WS_RESOLVE_BASIS`. Create the exact titles `resolution basis: proven missing suffix is absent-suffix` and `resolution basis: unreadable non-directory and failed absence stay unmeasured`, plus neighboring cases that pin:
  - complete existing path -> rc 0, canonical path, `complete`;
  - proven missing suffix -> rc 0, projected path, `absent-suffix`;
  - recursive logical-`..` resolution -> preserves the recursive call's basis;
  - unreadable, non-directory, control-character, unresolved-`..`, failed absence proof -> nonzero, empty path, `unmeasured`;
  - a second failed call cannot retain a prior call's path or basis.

Run:

```bash
./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'resolution basis'
```

Expected: FAIL because Task 1 has no `_WS_RESOLVE_BASIS`.

- [ ] **Step 2: Add the direct removed-alias placement reproduction.** Create exact title `removed ancestor alias is unmeasured`. In a fixture HOME:
  1. create the child;
  2. create an ancestor alias to the child's worktree root;
  3. write an alternate row whose workdir reaches a directory inside the child through that alias;
  4. prove while the alias exists that resolver basis is `complete` and placement is terminal `containment-unproven`;
  5. remove only the alias, leaving the row spelling and child tree intact;
  6. prove the same row now produces `absent-suffix` and the ladder returns `unmeasured`, no token.

The alternate row's raw spelling must not occur in detail/stderr. Assert row ID presence and target tree/branch/alternate row byte identity.

- [ ] **Step 3: Add the removed alias reached through real `..` reproduction.** Create exact title `removed ancestor alias through real dotdot is unmeasured`. Build a logical path whose existing alias is entered before `..` determines the logical parent. Prove the complete-existing control resolves where logical Bash entry lands. Remove the alias so the same spelling's remaining suffix can only be projected below proven absence. Assert the basis becomes `absent-suffix` and the alternate row makes the ladder `unmeasured`. Keep the input string literal; do not normalize it through Node path utilities.

- [ ] **Step 4: Add audit behavior and privacy RED.** In `ccd-child-reclaim-audit.test.ts`, create exact titles `absent-suffix alternate row is unmeasured and mints no token` and `alternate projection diagnostics omit raw workdir and newline payload`. The first case covers the full ambiguous-row result; the second isolates diagnostic privacy. Pin:
  - command exits 1;
  - document remains reclaim-mode with `verdict:"unmeasured"`;
  - `token` is absent;
  - detail and stderr include only the alternate row ID;
  - detail/stderr omit raw alias path, missing suffix, control/newline payload, and any injected `ccd:` line;
  - `eventsOf(home, 'reclaim')` has no terminal refusal row;
  - target tree, branch, alternate row, pane model, and unit-call record remain unchanged.

Run:

```bash
./node_modules/.bin/vitest run \
  test/ccd-child-reclaim-ladder.test.ts \
  test/ccd-child-reclaim-audit.test.ts \
  -t 'absent-suffix|removed ancestor alias|namespace projection'
```

Expected before the basis guard: FAIL because the resolver-era consumer treats rc 0 as physical placement proof and may mint a token.

- [ ] **Step 5: Implement the minimal basis state machine.** In `ccd/ccd`:
  - declare `_WS_RESOLVE_BASIS='unmeasured'` beside `_WS_RESOLVED`;
  - reset both globals at resolver entry;
  - set `complete` only for the empty-rest success;
  - set `absent-suffix` only after proven absence and complete textual assembly;
  - leave failure as empty/`unmeasured`;
  - preserve recursive results without caller relabeling;
  - in `_ws_reclaim_workdir_shared`, capture the basis produced by the same alternate-row call that produced `wr`;
  - retain literal equality/nested/through checks independently;
  - spell the alternate capture exactly once as `basis="$_WS_RESOLVE_BASIS"; [[ "$basis" == complete && -n "$mine" ]] && rok=1`, so Task 4 row 3 can delete only the basis gate;
  - allow alternate-row physical equality/nesting/through comparison only through that `rok` proof;
  - collect `absent-suffix`, `unmeasured`, empty, and unknown basis under the existing retryable placement failure with the exact append `unres+="${unres:+, }$o"`, naming row IDs only.

Do not make `_ws_reclaim_resolve` globally return nonzero for projected subject paths. Do not add liveness or process inspection.

- [ ] **Step 6: GREEN the focused suites and re-stamp.** From repository root and then `server/`:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
node shared/mark.mjs --check ccd/ccd
bash -n ccd/ccd
cd server
./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts test/ccd-child-reclaim-audit.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts \
  -t 'absent-suffix|removed ancestor alias|locked recomputation|fresh final ownership|resumed final ownership|defer-expired|liveness independent|repairing the alias'
```

Expected: PASS, including the seam cases already recorded RED in Task 3.

- [ ] **Step 7: Pay S6-R11 in this same ccd task.** From `server/`:

```bash
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
```

Expected: both PASS after content-based repair and remeasurement of every affected citation-debt map, `README` anchor, `**Files:**` location index, `|`-row set, and range bound. Do not carry Task 1's counts forward: this task's own insertion is a new layout. If this task adds `_reg_get`, run `test/ccd-reg-get-census.test.ts`; none is expected.

- [ ] **Step 8: Commit the proof-qualified consumer.** From repository root:

```bash
git add ccd/ccd server/test/ccd-child-reclaim-ladder.test.ts server/test/ccd-child-reclaim-audit.test.ts
git add README.md server/test/session-hook.test.ts  # omit each unchanged path
git commit -m "fix(reclaim): require complete alternate row placement

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3 — RED every destructive seam on the resolver-only baseline

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Modify: `server/test/ccd-child-reclaim-verb.test.ts`
- Modify only if an executable behavior test proves necessary: `ccd/ccd`
- Test: `server/test/ccd-child-reclaim-verb.test.ts`, `server/test/ccd-child-reclaim-ladder.test.ts`, `server/test/ccd-child-reclaim-audit.test.ts`

**Ordering:** Execute this task after Task 1 and before Task 2. Task numbering preserves the four work-item grouping, but red-first evidence follows the code dependency: Task 1 ports the resolver, Task 3 adds and runs every end-to-end seam case RED while rc-0 projection is still trusted, then Task 2 installs the one shared basis guard and reruns Task 2 plus Task 3 GREEN.

**Interfaces:**
- Consumes: Task 1's resolver-only `_ws_reclaim_workdir_shared`; `childReclaimVerb(h, token, { childOf?, extra?, pre? })`; `otherSnapshot`; fixture-local registry, tmux, service, tombstone, breadcrumb, and lifecycle helpers.
- Produces: recorded RED evidence for every destructive seam on the resolver-only baseline, followed by GREEN proof once Task 2 installs the complete-only helper; no new production API.

- [ ] **Step 1: Add a reusable local test builder, not a production helper.** Inside the verb test file, define a small test-local builder that plants a child, an ancestor alias, and an alternate row; it returns the raw row spelling plus snapshots of:
  - child tree and branch tip/history;
  - alternate registry row bytes;
  - modeled tmux sessions/clients/fault files;
  - `h.calls()` unit/pane-call record;
  - tombstone/breadcrumb presence.

It must support `removeAlias()` and `repairAlias()` (renamed `repointAlias()`, as recorded in D-3735) so one fixture proves complete, ambiguous, and recovered states. Do not change `childReclaimFixture.ts`; its present APIs are sufficient.

- [ ] **Step 2: RED the locked recomputation seam.** Create exact title `locked recomputation rejects an old token after alias removal`. Mint a valid audit token before the alternate row appears. Add the row, remove its alias, then call `childReclaimVerb` with the old token. Assert:
  - exit 1 with `failed:"probe-unmeasured"`, not `state-changed` and not a terminal refusal;
  - no WIP/attic/tombstone/breadcrumb was created;
  - no unsupervise or pane kill occurred;
  - child and alternate-row snapshots are byte-identical.

This proves a token cannot survive a new ambiguous row. Run the named case on Task 1's resolver-only baseline, before Task 2 changes production, and record its assertion-level RED.

- [ ] **Step 3: RED the fresh final ownership race.** Create exact title `fresh final ownership remeasures alternate projection`. Use `childReclaimVerb(..., { pre })` or the existing seam-local race fixture so the locked ladder accepts a complete outside row, then the pre-hook removes the alias immediately before `_ws_reclaim_owned`. The test must record that hook in a fixture file and contain the exact source line `expect(fs.existsSync(preHookMarker)).toBe(true); // MUTATION_FRESH_PREHOOK`. Assert `failed:"worktree-remove-failed"`; the target tree, branch, competing row, and tombstone-referenced pins remain; the final ownership detail names the row ID and omits the raw workdir. This is a final remeasurement case, not another audit case.

- [ ] **Step 4: RED the resumed final ownership arm.** Create exact title `resumed final ownership remeasures alternate projection`. Build the existing tombstone/breadcrumb state with `interrupted(c, 'worktree')`, then include the exact source line `expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree'); // MUTATION_RESUMED_PHASE` before invoking the verb. Plant/remove the alternate alias and call with the resume token. Assert `failed:"worktree-remove-failed"`, breadcrumb retained, child tree and branch retained, competing row retained, and no later destructive phase executed. This arm has no fresh ladder in front of it, so `_ws_reclaim_owned` is its only cross-row re-proof.

- [ ] **Step 5: Pin `--defer-expired` non-bypass.** Create exact title `defer-expired does not bypass ambiguous alternate ownership`. Exercise both:
  - audit/evaluation with defer set returns `unmeasured` and no token for the ambiguous alternate row;
  - a deferred token minted before the row appears is rejected by locked recomputation after ambiguity appears.

The deferred flag changes fingerprint semantics only. It must not reach pin/removal.

- [ ] **Step 6: Pin liveness independence as one explicit matrix.** For the identical ambiguous alternate row, create these exact titled tests and modeled states:
  - `liveness independent: live alternate projection refuses`: alternate session present in `tmux-sessions`; put `// MUTATION_LIVE_AUTHORITY` on its one `expect(answer.verdict).toBe('unmeasured')` line;
  - `liveness independent: gone alternate projection refuses`: no matching modeled session; put `// MUTATION_GONE_AUTHORITY` on its one verdict line;
  - `liveness independent: unknown alternate projection refuses`: iterate the three exact `TMUX_FAULTS` values — permission denied, no server running, no socket — and write one literal `expect(answer.verdict).toBe('unmeasured') // MUTATION_UNKNOWN_AUTHORITY` statement per subcase, for exactly three source matches.

Use liveness only as fixture state; production placement receives no liveness argument. Every row must return the same unmeasured placement outcome at the same seam and preserve byte-identically: target tree, branch, competing row, tmux model files, and unit-call record. Where tmux state would make the subject child's earlier rung win, isolate the alternate session under another ID or call the placement seam directly so the test actually discriminates placement authority rather than rung 5. The sentinel comments exist only to make Task 4's exact mutation edits machine-checkable; they do not replace the unchanged disk/Git assertions.

- [ ] **Step 7: Add positive and precedence controls.** Pin all of these independently:
  - exact title `complete existing outside alternate row is non-blocking`: fully resolved outside row -> reclaim remains eligible;
  - exact title `complete existing inside alternate row is containment-unproven`: fully resolved inside row -> `containment-unproven`;
  - exact title `literal containment outranks incomplete physical basis`: literal same/nested/through row with incomplete physical basis -> still `containment-unproven`, never downgraded to `unmeasured`;
  - exact title `vanished subject remains reclaimable under R19`: subject child removed with no ambiguous alternate row -> R19 remains reclaimable and verb completes its existing absent-worktree path;
  - exact title `repairing the alias restores complete outside placement`: repair the alias so the row resolves completely outside -> ordinary behavior returns (renamed `a re-pointed alias resolves complete outside and reclaims: the pre-existing re-point class, not a recovery` and recast as a known hole, as recorded in D-3735);
  - exact title `removing the ambiguous alternate row restores ordinary behavior`: remove the ambiguous alternate row -> ordinary behavior returns.

For any control that actually reclaims, use a fresh fixture; do not reuse a fixture whose destructive call already changed state.

- [ ] **Step 8: Run the exact end-to-end selector RED before Task 2.** From `server/`, still on Task 1's resolver-only production:

```bash
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts \
  -t 'absent-suffix|removed ancestor alias|locked recomputation|fresh final ownership|resumed final ownership|defer-expired|liveness independent|repairing the alias'
```

Expected: every safety case that depends on rejecting projection FAILS at its named assertion because the resolver-only consumer still trusts rc 0; the complete-existing and subject-R19 controls PASS. A syntax/import failure is not evidence. Record each failing case and assertion, then execute Task 2.

- [ ] **Step 9: Re-run the exact selectors GREEN after Task 2.** Once Task 2 Step 5 installs the shared complete-only guard and Task 2's own suites pass, return here and run:

```bash
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts \
  -t 'absent-suffix|removed ancestor alias|locked recomputation|fresh final ownership|resumed final ownership|defer-expired|liveness independent|repairing the alias'
./node_modules/.bin/vitest run \
  test/ccd-child-reclaim-ladder.test.ts \
  test/ccd-child-reclaim-audit.test.ts \
  test/ccd-child-reclaim-verb.test.ts
```

Expected: PASS. If a seam remains red, change the smallest existing consumer necessary, rerun the case RED against a distinct bypass mutation, and do not create a second placement policy or liveness-aware bypass.

- [ ] **Step 10: Re-stamp and pay S6-R11 only if this task changes production, then commit.** If no Task 3 behavior test proves an additional `ccd/ccd` edit necessary, stage and commit only the verb tests:

```bash
git add server/test/ccd-child-reclaim-verb.test.ts
git commit -m "test(reclaim): pin projected row across destructive seams

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

If Task 3 does change `ccd/ccd`, re-stamp it, run `bash -n`, run both Task 1 citation selectors, repair and remeasure every changed citation/census in this same task, stage `ccd/ccd` plus any proved `README.md`/`session-hook.test.ts` changes, and only then use the same commit message. Do not re-stamp merely to rewrite an identical marker.

---

### Task 4 — Amend the durable contract/spec and prove all mutations

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Modify: `docs/superpowers/programs/child-reclamation-contract.md`
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
- Modify: `docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md` only for a measured issued departure
- Test: all implementation files from Tasks 1–3

**Interfaces:**
- Consumes: Tasks 1–3's proven result vocabulary and seam behavior.
- Produces: durable R19/R31/spec wording and a complete mutation report. No runtime interface.

- [ ] **Step 1: Amend R31 narrowly.** After the existing R31 paragraph, state the proof-qualified invariant:
  - alternate rows prove non-containment only through `complete` current resolution;
  - an absent-suffix textual projection is namespace presentation, not identity evidence;
  - ambiguity makes reclaim `unmeasured` at audit, locked recomputation, fresh final ownership, and resumed final ownership (at the two final-ownership arms the refusal is `worktree-remove-failed`, as recorded in D-3736);
  - literal same/nested/through containment remains terminal;
  - `--defer-expired` does not bypass ownership;
  - diagnostics expose row IDs only;
  - process state never grants deletion consent.

- [ ] **Step 2: Preserve R19 explicitly.** Amend R19 or add a cross-reference immediately beside it stating that this complete-only rule applies to alternate-row destructive comparison, not to the subject child's own already-proven absent worktree. The subject still pins branch/stashes, records `worktree: absent`, and enters its existing tail (when every other row is placed, as recorded in D-3734).

- [ ] **Step 3: Amend design §5.5/§5.7.** Add the same distinction beside “A vanished worktree is not a refusal” and the ownership ladder. Explain why a retained process cwd cannot be reconstructed from a removed namespace alias and why liveness cannot authorize deletion. Keep the design's existing refusal vocabulary and cleanup ordering.

- [ ] **Step 4: Execute every exact mutation against its named control, one at a time.** Create a scratch directory outside the repository. Before each row copy every file named by that row into a row-specific backup, compute its SHA-256, and require each `old -> new` replacement below to match exactly once. Re-stamp `ccd/ccd`, run `bash -n`, run the exact selector, and require nonzero vitest status plus the named assertion-level RED. In a `finally`/trap restore every file from its backup, require the restored SHA-256 to equal the saved value, re-stamp only if the saved file was the pre-stamp source, and rerun the selector GREEN. Never use `git checkout`, `git restore`, or a syntax/import crash as proof. Record exact commands, failing title/assertion, and green-after-restore in the handoff.

The test titles below are exact titles to create in Tasks 2–3. If implementation needs to change a title, amend this table before running mutations so the selector remains literal and non-vacuous. Unless a row says otherwise, the production file is `ccd/ccd`, and `old`/`new` refers to the final bytes shipped by Tasks 1–3.

| # | Exact edit (`old` -> `new`) | Exact selector from `server/` | Expected assertion-level RED |
|---|---|---|---|
| 1 | `  _WS_RESOLVE_BASIS='absent-suffix'` -> empty string | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'resolution basis: proven missing suffix is absent-suffix'` | basis is `unmeasured` instead of `absent-suffix` |
| 2 | `  _WS_RESOLVE_BASIS='absent-suffix'` -> `  _WS_RESOLVE_BASIS='complete'` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t 'absent-suffix alternate row is unmeasured and mints no token'` | verdict/token assertion shows the projection was permitted |
| 3 | After the alternate call, delete only the basis gate: `basis="$_WS_RESOLVE_BASIS"; [[ "$basis" == complete && -n "$mine" ]] && rok=1` -> `basis="$_WS_RESOLVE_BASIS"; [[ -n "$mine" ]] && rok=1` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'removed ancestor alias is unmeasured|removed ancestor alias through real dotdot is unmeasured'` | both placement cases accept projection instead of returning `unmeasured` |
| 4 | Production: apply row 3's exact bypass. Test: replace exactly `expect(answer.verdict).toBe('unmeasured') // MUTATION_LIVE_AUTHORITY` -> `expect(answer.verdict).toBe('reclaimable') // MUTATION_LIVE_AUTHORITY` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^liveness independent: live alternate projection refuses$'` | the verdict assertion passes only under the forbidden grant, then the unchanged tree/branch/row/call preservation assertion reds after destructive work; restore both files |
| 5 | Production: apply row 3's exact bypass. Test: replace exactly `expect(answer.verdict).toBe('unmeasured') // MUTATION_GONE_AUTHORITY` -> `expect(answer.verdict).toBe('reclaimable') // MUTATION_GONE_AUTHORITY` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^liveness independent: gone alternate projection refuses$'` | the unchanged disk/Git preservation assertion reds; absence of the modeled session did not make projection identity evidence |
| 6 | Production: apply row 3's exact bypass. Test: replace all three exact lines `expect(answer.verdict).toBe('unmeasured') // MUTATION_UNKNOWN_AUTHORITY` -> `expect(answer.verdict).toBe('reclaimable') // MUTATION_UNKNOWN_AUTHORITY`, requiring replacement count 3 | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^liveness independent: unknown alternate projection refuses$'` | permission-denied, no-server, and no-socket subcases each reach their unchanged preserved-state assertions and red; restore both files |
| 7 | Replace the unique locked statement `_ws_reclaim_fork "$id" "$defer" "$childof"` -> `_ws_reclaim_fork "$id" "$defer" "$childof"; REAP_VERDICT=reclaimable; REAP_TOKEN="$token"` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^locked recomputation rejects an old token after alias removal$'` | expected `probe-unmeasured` is lost and the unchanged pre-pin state assertion reds |
| 8 | Replace the unique eval statement `_ws_reclaim_workdir_shared "$id" "$workdir" \\` -> `: \\` while retaining its existing `|| { ... }` continuation | `./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t '^absent-suffix alternate row is unmeasured and mints no token$'` | audit becomes reclaimable or emits a token/journal row |
| 9 | Replace the unique ownership statement `_ws_reclaim_workdir_shared "$id" "$wd" \\` -> `: \\` while retaining its existing `|| { ... }` continuation | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^(fresh|resumed) final ownership remeasures alternate projection$'` | fresh and resumed final state-preservation assertions red |
| 10 | In the exact fresh test, replace `expect(fs.existsSync(preHookMarker)).toBe(true); // MUTATION_FRESH_PREHOOK` -> `expect(fs.existsSync(preHookMarker)).toBe(false); // MUTATION_FRESH_PREHOOK` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^fresh final ownership remeasures alternate projection$'` | the sentinel assertion reds because the pre-hook marker exists, proving the promised final-race seam executed; restore the test, then row 9 must red the unchanged final disk-state assertion |
| 11 | In the exact resumed test, replace `expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree'); // MUTATION_RESUMED_PHASE` -> `expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:branch'); // MUTATION_RESUMED_PHASE` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^resumed final ownership remeasures alternate projection$'` | the sentinel assertion reds on the planted `reclaim:worktree` phase, proving the resume starts at the promised arm; restore the test, then row 9 must red the unchanged resumed disk-state assertion |
| 12 | Replace the unique locked statement `_ws_reclaim_fork "$id" "$defer" "$childof"` -> `if (( defer )); then REAP_VERDICT=reclaimable; REAP_TOKEN="$token"; else _ws_reclaim_fork "$id" "$defer" "$childof"; fi` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t '^defer-expired does not bypass ambiguous alternate ownership$'` | the deferred old-token case proceeds past locked proof and reds its unchanged preserved-state assertion (this exact edit is non-viable on current main and was executed as recorded in D-3732) |
| 13 | Replace the unique subject call `if _ws_reclaim_resolve "$wd"; then` -> `if _ws_reclaim_resolve "$wd" && [[ "$_WS_RESOLVE_BASIS" == complete ]]; then` (made exact as recorded in D-3737) | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts test/ccd-child-reclaim-verb.test.ts -t '^vanished subject remains reclaimable under R19$'` | vanished subject becomes `unmeasured` instead of following R19, in the ladder and in the verb |
| 14 | Change one failure return after `_ws_reclaim_absent ... || return 1` to `|| { _WS_RESOLVE_BASIS='absent-suffix'; return 0; }` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'resolution basis: unreadable non-directory and failed absence stay unmeasured'` | failed/unreadable spelling reports rc 0 and `absent-suffix` |
| 15 | Replace `lit=0; [[ "$w" == "$wd" || "$w" == "${wd%/}/"* ]] && lit=1` with `lit=0` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'literal containment outranks incomplete physical basis'` | same/nested/through literal control becomes retryable `unmeasured` instead of terminal `containment-unproven` |
| 16 | Apply these three unique replacements in one mutation: `{ (( rok )) && [[ "$wr" == "$mine" ]]; }` -> `false`; `{ (( rok )) && [[ "$wr" == "${mine%/}/"* ]] && _ws_reclaim_plain_path "$wr"; }` -> `false`; `{ (( rok )) && [[ "$wr" == "${mine%/}/"* ]]; }` -> `false` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t '^complete existing inside alternate row is containment-unproven$'` | fully resolved inside row is permitted instead of terminal refusal |
| 17 | Replace the unique reclaim-audit branch `if [[ "$REAP_VERDICT" == reclaimable ]]; then` -> `if [[ "$REAP_VERDICT" == reclaimable || "$REAP_VERDICT" == unmeasured ]]; then` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t '^absent-suffix alternate row is unmeasured and mints no token$'` | token-absence assertion reds; the no-terminal-journal assertion remains its control |
| 18 | In the final alternate-basis collector statement required by Task 2, replace `unres+="${unres:+, }$o"` -> `unres+="${unres:+, }$w"` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t '^alternate projection diagnostics omit raw workdir and newline payload$'` | raw alias/suffix or injected newline payload appears in detail/stderr |
| 19 | Hoist the per-row reset (added as recorded in D-3733): `names n o w wr rok basis rc lit` -> `names n o w wr rok=0 basis rc lit`, and `wr=''; rok=0; basis=''` -> `wr=''; basis=''` | `./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t '^a complete row listed before a projected row lends it no placement proof$'` | in the `complete-first` listing order the projected row inherits the complete row's `rok=1`, and the verdict is `reclaimable` instead of `unmeasured` |

Rows 4–6 are deliberate two-file authorization mutants: production has no liveness branch to delete, so each exact `MUTATION_*_AUTHORITY` test line states the forbidden grant while row 3 makes it executable; unchanged byte-level preservation assertions, not the changed verdict expectation, are the required RED. Task 3 must create those five literal sentinel comments exactly as tabled (one live, one gone, three unknown). Rows 10–11 mutate exact `MUTATION_FRESH_PREHOOK` and `MUTATION_RESUMED_PHASE` assertion statements first to prove each test reached the promised arm, restore the test bytes, then require production row 9 to red the arm's unchanged disk-state assertion. For every row, require each tabled old string to match once before editing, except row 6's test sentinel must match exactly three times; a count mismatch fails the row rather than permitting a broad or derived replacement.

- [ ] **Step 5: Run documentation and deviation guards.** From repository root/server:

```bash
git diff --check
cd server
./node_modules/.bin/vitest run test/deviation-refs.test.ts test/ledger-crosstree.test.ts test/dtbd.test.ts
```

Expected: PASS. The plan/programme define only the issued numbers in "Deviations found"; unused issued slots remain unrendered.

- [ ] **Step 6: Commit docs and mutation evidence.** Put the exact mutation commands/results in the commit body or worker handoff report; do not add a second hand-maintained production list. Commit:

```bash
git add docs/superpowers/programs/child-reclamation-contract.md \
  docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md \
  docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md
git commit -m "docs(reclaim): define complete row placement proof

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5 — Re-stamp, pay citation debt, merge current main, run gates, and open one PR

**Model routing:** Main loop Opus, effort `xhigh`; implementation subagents Sonnet, effort `high`; workflows off; compact threshold 40.

**Files:**
- Modify through merge resolution only: files from Tasks 1–4
- Verify: `ccd/ccd`, reclaim suites, repo-wide guards, package suites

**Interfaces:**
- Consumes: Tasks 1–4 and current `origin/main`.
- Produces: a clean pushed child branch, one open prerequisite PR, exact four-item wave-done evidence, and no deployment.

- [ ] **Step 1: Fetch and merge current main, never rebase.** From repository root:

```bash
git fetch origin main
git merge --no-edit origin/main
```

Resolve `ccd/ccd` semantically by combining current-main behavior with this branch's resolver/basis changes, then regenerate the marker. Never take either side wholesale. Re-run every affected test after conflict resolution.

- [ ] **Step 2: Pay S6-R11 after the final generated layout.** Locate all affected frozen citations by content, never historical line number. The frozen boundary measured for this programme is `ccd/ccd:19131`. From `server/`, run the real selector:

```bash
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
```

Also run the supplementary diagnostic selector:

```bash
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
```

Remeasure and report all citation-debt maps, `**Files:**` sets, `|`-row sets, location indexes, and range bounds affected by insertions. Do not weaken an anchor or expected census merely to make it green. If the resolver port adds an `_reg_get` call, run `test/ccd-reg-get-census.test.ts`; no such new call is expected.

- [ ] **Step 3: Final generated/syntax checks.** From repository root:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
node shared/mark.mjs --check ccd/ccd
bash -n ccd/ccd
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Run scoped behavioral and guard suites in the foreground.** From `server/` with timeout >=600000 ms:

```bash
./node_modules/.bin/vitest run \
  test/ccd-child-reclaim-ladder.test.ts \
  test/ccd-child-reclaim-audit.test.ts \
  test/ccd-child-reclaim-verb.test.ts \
  test/ccd-child-reclaim-pin.test.ts \
  test/ownership.test.ts \
  test/session-hook.test.ts \
  test/deviation-refs.test.ts \
  test/ledger-crosstree.test.ts \
  test/dtbd.test.ts
```

Run every additional server test selected by the repository's changed-file selector. Touched-file-only suites are not sufficient because generated/citation/deviation guards scan broader roots.

- [ ] **Step 5: Run all package suites/builds required for a generated ccd change.** Foreground only, timeout >=600000 ms:

```bash
cd server && npm run test
cd ../agent && npm run test && npm run build
cd ../pwa && npm run test && npm run build
```

There is no root package runner. If a known load flake fails, re-run its exact file in isolation and report both results. The standing operator ruling makes macOS CI legs non-gating, but report their actual status; do not call unrun portability evidence green.

- [ ] **Step 6: Verify source boundary and placeholders before handoff.** From repository root:

```bash
git diff --check origin/main...HEAD
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const files = [
  'docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md',
];
const patterns = [
  new RegExp(`\\b${['TO', 'DO'].join('')}\\b`, 'i'),
  new RegExp(`\\b${['T', 'BD'].join('')}\\b`, 'i'),
  new RegExp(['D-', 'T', 'BD-'].join(''), 'i'),
  new RegExp(['similar', ' to'].join(''), 'i'),
  new RegExp(['appropriate', ' error handling'].join(''), 'i'),
  new RegExp(['add', ' validation'].join(''), 'i'),
  new RegExp(['handle', ' edge cases'].join(''), 'i'),
  new RegExp(['write tests', ' for the above'].join(''), 'i'),
];
const hits = [];
for (const file of files) {
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    for (const pattern of patterns) {
      if (pattern.test(line)) hits.push(`${file}:${index + 1}:${pattern.source}`);
    }
  }
}
if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
NODE
rg -n '_WS_RESOLVE_BASIS|_ws_reclaim_resolve|_ws_reclaim_workdir_shared' ccd/ccd
```

The Node scan must exit 0 with no output; its source constructs the forbidden phrases so the scan does not match its own command text. Review the final diff to ensure it contains no historical hardening suite wholesale, process-cwd inspection, run-199 entry/install work, Wave 4 minors, Wave 5 scope, or unrelated call-site hunks.

- [ ] **Step 7: Commit final integration and push.** From repository root:

```bash
git status --short
git add ccd/ccd server/test/ccd-child-reclaim-ladder.test.ts \
  server/test/ccd-child-reclaim-audit.test.ts server/test/ccd-child-reclaim-verb.test.ts \
  docs/superpowers/programs/child-reclamation-contract.md \
  docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md \
  docs/superpowers/plans/2026-10-01-reclaim-row-placement-safety.md \
  README.md server/test/session-hook.test.ts
if ! git diff --cached --quiet; then
  git commit -m "fix(reclaim): integrate projected row safety with current main

Co-Authored-By: Claude Code <noreply@anthropic.com>"
else
  printf '%s\n' 'no post-merge integration delta; Tasks 0-4 already contain the final tree'
fi
git push -u origin HEAD
```

Omit unchanged paths from `git add`. A no-delta integration is valid and creates no empty commit; record that outcome in wave-done. The branch must be clean after push.

- [ ] **Step 8: Open one PR against `main`.** The PR body must report:
  - the removed-alias defect and complete/absent-suffix distinction;
  - immutable source `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08` and the selective-port boundary;
  - R19 preservation and lack of process/liveness authorization;
  - audit, locked, fresh-final, resumed-final, deferred, privacy, recovery, and complete inside/outside evidence;
  - all eighteen mutation results;
  - generated stamp, S6-R11 counts, package tests, Linux result, honest macOS/CI state, and deviations;
  - no deployment or manual rollout.

End the PR description with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Do not merge and do not use `--delete-branch`.

- [ ] **Step 9: Send wave-done only after push and PR-open.** Report the exact full handoff commit, branch, clean status, PR URL/number/head SHA, all four exact machine-readable items, test and mutation evidence, stamp, deviations, remaining CI, and any honest portability gap. Do not sleep or poll CI.

## Exact machine-readable work items

These four strings are authoritative. Dispatch and wave-done use them byte-for-byte, without terminal punctuation:

1. `Distinguish complete alternate-row placement from absent-suffix projection`
2. `Fail shut ambiguous alternate rows across audit, locked and final reclaim seams`
3. `Preserve vanished-subject behavior and prove liveness-independent mutations and controls`
4. `Merge current main, run the required gates, and open the row-placement prerequisite PR`

## Explicit exclusions

- Process-entry, Python-launcher, installer, update, deploy, or capability-cache work owned by run 199.
- Process-cwd inspection, `pane_current_path`, `/proc`, `lsof`, libproc, or real-tmux tests.
- Wave 4's two remaining review minors or any unrelated Wave 4 implementation.
- Wave 5 reclaim chip, attention list, and orphan temp-root collection.
- New wire fields, protocol changes, dependencies, refusal tokens, or server coordination behavior.
- Manual rollout, live fleet mutation, merging this PR, or deleting its branch.
- Whole-branch import/cherry-pick from `ws/swift-hollow` or restoration of historical split test suites.

## Deviations found

Numbers are issued, never chosen. The coordinator allocated this run's block exactly once at run-open. A worker never calls the allocator. Define an issued number here only after measuring the departure, and never spell unused issued slots as a range of `D-` tokens.

- **D-3731 — `alternate-row-absent-suffix-is-not-placement-proof`.** The inherited resolver contract reports both a complete current resolution and a textual suffix reconstructed below a proven-absent component as rc 0 plus one path string. That was sufficient for non-destructive path presentation and for the target child's deliberate R19 vanished-worktree arm, but it is not sufficient evidence for destructive comparison against another registry row: the removed spelling may still name a process-retained physical cwd. This wave adds a proof basis and requires the alternate-row consumer to accept only `complete`; `absent-suffix`, `unmeasured`, empty and unknown bases make the ownership result unmeasured. This is a measured strengthening of R31 rather than a global missing-path refusal, so the subject child's existing absent-worktree behavior remains unchanged.
- **D-3732 — `mutation-row-12-non-viable-on-current-main`.** Mutation row 12's exact edit replaces the locked statement's `_ws_reclaim_fork` call with a deferred-path branch that never calls it. On current main `_ws_reclaim_locked` reads `$RECLAIM_RESUME_PHASE` on its next line, only `_ws_reclaim_fork` sets that global, and ccd runs under `set -u`. Measured: the mutant died with `RECLAIM_RESUME_PHASE: unbound variable` before any pin, the preserved-state assertion stayed green, and only the verb's exit-code check went red — a crash, which Task 4 Step 4 forbids as proof. The row was executed instead as `_ws_reclaim_fork "$id" "$defer" "$childof"; if (( defer )); then REAP_VERDICT=reclaimable; REAP_TOKEN="$token"; fi`: the fork runs and sets every global it owns, and only the deferred path is then forced past the locked proof. That mutant reds `defer-expired does not bypass ambiguous alternate ownership` at its preserved-state assertion — the verb journals its `intent` row and then a `pin-failed` row, because a forced verdict carries no measured branch — and the selector is green again after a byte-identical restore. Row 12's tabled edit is otherwise left as written.
- **D-3733 — `per-row-placement-reset-unpinned`.** Review 212 (F10) measured that the per-row reset `wr=''; rok=0; basis=''` in `_ws_reclaim_workdir_shared` was pinned by nothing. Hoisting `rok=0` to the `local` line (its X2b) kept all 351 ladder, audit and verb tests green, while a probe answered `reclaimable` once a complete row preceded the projected one in `find`'s order. The plan's 18 rows had no row for it. This round adds the ladder case `a complete row listed before a projected row lends it no placement proof`. It plants name pairs in alternating creation orders, reads the order `find` lists for each placement, asserts both orders were exercised, and requires `unmeasured` naming the projected row by id every time. Row 19 is added to Task 4's table. Measured: the X2b mutant reds the case at its verdict assertion in the `complete-first` order (`expected 'reclaimable' to be 'unmeasured'`), and a byte-identical restore makes it green again.
- **D-3734 — `ambiguous-row-hold-reaches-vanished-subject`.** The Global Constraint "Preserve R19 exactly" and Task 4 Step 2 promised that the subject child's proven-absent worktree stays reclaimable. R19's own arm is unchanged: the subject is not held to `complete`, as row 13 proves. But the complete-only rule refuses every non-complete alternate row, not only a removed alias. So a row whose directory is gone holds a vanished subject as it holds a present one, and two vanished children hold each other. Review 212 (F1) found this, and the operator ruled the hold to be D-3731's accepted cost: documented and pinned, not fixed. Three ladder cases pin it, each answering `unmeasured` and naming the other row by id: `ambiguous row hold: a present child beside an unrelated gone-directory row is unmeasured`, `ambiguous row hold: a vanished subject beside a vanished sibling row is unmeasured`, and `ambiguous row hold: two vanished children hold each other`. Each has a control in which the same subject reclaims while the other row's directory stands. The contract's R19 sentence and cost bullet, the spec's §5.5 and the constraint above are qualified to match. The coordinator's ruling on F2 corrects the stated duration in the same place. The hold lasts until the row is purged or its path is restored, AND a later attempt runs. The only retry is wave 4's sweep, so until that ships a held child keeps its tree after its one close-time attempt. Recovery evidence is carried to wave 5 by the coordinator and is not implemented here.
- **D-3735 — `complete-places-the-spelling-not-the-session`.** Three places presented re-pointing the alias at a complete outside path as a recovery: the Review Focus, Task 3 Step 1 (`repairAlias()`) and Task 3 Step 7's exact title `repairing the alias restores complete outside placement`. Review 212 (F3, F4) showed that a `complete` resolution places the spelling as it reads now, not the session. An alias re-pointed after a session entered through it resolves complete and outside, and so does a spelling through a bind mount. Either way the reclaim removes the tree that session still holds. That class is pre-existing (the base behaves the same), and the operator ruled it be documented now and fixed in a follow-up.
  - This round caveats the contract's R31 text and the spec's §5.5 and §5.7.
  - It renames the verb control to `a re-pointed alias resolves complete outside and reclaims: the pre-existing re-point class, not a recovery`, and its lever to `repointAlias()`.
  - It changes the unresolved-row remedy in `_ws_reclaim_workdir_shared` from "restore what its path ran through, or stop and purge the row" to "restore its path to what it ran through, or purge the row once its session has ended". A ladder assertion pins that this detail never says `re-point`.
  - The removed-row control stays the recovery.
  - The selectors of Task 2 Step 6 and Task 3 Steps 8–9 were executed with the alternative `repairing the alias`. On a re-run that alternative matches nothing, and `re-pointed alias` reaches the renamed case.
  - F8 (the pre-existing window before `git worktree remove`) joins the same follow-up.
- **D-3736 — `tail-placement-refusal-is-worktree-remove-failed`.** Task 4 Step 1 told the contract to say that ambiguity makes the reclaim `unmeasured` at all four seams, and the contract and spec said so, adding "no terminal journal row". At the tail that is not what happens, and Task 3 Steps 3–4 never asked for it. There `_ws_reclaim_owned`'s refusal fails the reclaim through `_ws_reclaim_fail` as `worktree-remove-failed`, which writes a journal row and keeps the tree, the branch and the breadcrumb. Both final-ownership tests assert exactly that. Review 212 (F5) found the mismatch. The contract and spec now state `unmeasured` for the audit and the locked recomputation, and `worktree-remove-failed` for the fresh and the resumed tail. Production is unchanged.
- **D-3737 — `mutation-row-13-made-exact`.** Row 13 combined two edits. Its first half relabelled every `complete` answer as `absent-suffix`, alternate rows included, so its R19 red was overdetermined. Its second half was prose, not an exact edit. Review 212 (F9) measured that the subject-only half alone reds both R19 tests. Row 13 is now that one exact edit, `if _ws_reclaim_resolve "$wd"; then` -> `if _ws_reclaim_resolve "$wd" && [[ "$_WS_RESOLVE_BASIS" == complete ]]; then`, and its selector names both files. Measured on this round's bytes, it reds `vanished subject remains reclaimable under R19` in the ladder and in the verb at the verdict assertion (`expected 'unmeasured' to be 'reclaimable'`). The detail there says the subject's own workdir cannot be resolved, so no other row can be placed against it. A byte-identical restore makes both green again.

---

## Wave-done and official review

The worker's report is a claim. The coordinator remeasures the exact branch tip, clean state, PR head/state, generated marker, plan and deviation definitions, tests, mutation evidence, and all four machine-readable items, then submits that exact fingerprint to run 208. Items settle only after the server accepts the same fingerprint.

Official acceptance comes from a distinct `kind:"review"` run in its own worktree reading the one server-accepted tip. It runs the held-out panel literally: Opus/high correctness, specification-conformance, and reproducibility lenses; three Sonnet/high refuters per finding; majority rules. Add one independent Opus/xhigh destructive SAFETY lens over removed aliases, resolver basis, literal precedence, audit/lock/final seams, R19, defer, liveness independence, privacy, and byte-level disk-state evidence. A dead or empty lens is unverified, never approval. The coordinator does not substitute its own diff reading.

If official review accepts, merge with the exact head guard and admin bypass, never deleting the branch. Observe release creation and ccrc's own automatic convergence read-only. Only after this prerequisite is merged and live may run 199 merge current `origin/main`, re-stamp `ccd/ccd`, finish its existing item 4, and enter its own handoff/review. Child-reclamation Wave 4 remains blocked until both prerequisite PRs merge.
