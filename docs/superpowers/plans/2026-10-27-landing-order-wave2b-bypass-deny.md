# Landing order, wave 2b — the bypass deny: `--admin` and `gh api` merges, refused in every session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session hook's PreToolUse merge arm refuses, in every fleet session, the ways around the merge queue that its wave 2 deny leaves open:
- `gh pr merge … --admin`;
- a `gh api` call that reaches a merge. That is any of four mutations — `mergePullRequest`, `enqueuePullRequest`, `enablePullRequestAutoMerge`, `mergeBranch` — or either of two REST paths: the pulls merge endpoint `repos/<o>/<r>/pulls/<n>/merge`, and the branch merge endpoint `repos/<o>/<r>/merges`.

The coordinator's exact-head enqueue, `gh pr merge <n> --match-head-commit <sha>`, still passes in a session with no wave hold and no child marker. So does every read its landing verdict makes.

**Why:**
- Spec §5.2 says the hook "denies `--admin` in every fleet session, together with a `gh api` call that reaches the same merge". Its rollout step 4 puts that deny after the queue ruleset and approvals at 0, which hold on this repository since 2026-10-21.
- Ruling 5 (2026-10-25) gives merge governance to the repository's external policy authority: "until it answers (wave 2b) a coordinator never uses them". `main`'s skill already says so (`wave-lifecycle.md`'s ruling 5 sentence, pinned in `coordinator-skill.test.ts`). This wave makes "never" a mechanism.
- The deny reaches every project the fleet hosts. Before dispatch, the operator confirms that reach (Prerequisite).

**Architecture:**
- **The arm stays one arm, with one `jq`.** `ccd/session-hook.sh`'s merge deny keeps:
  - its single strip, `MERGE_STRIP_JQ`;
  - its payload cap, `MERGE_PARSE_CAP`;
  - `_hook_deny_json`;
  - the rule that a deny supersedes advice and never replaces the graph gate's deny.
- **What changes.**
  1. **The prefilter widens.** The arm also runs when the payload contains `Merge` or `enqueuePullRequest`, as well as `merge`. `mergeBranch` and `/merges` already contain `merge`. bash glob tests are case-sensitive, and `enqueuePullRequest` and `enablePullRequestAutoMerge` contain no lowercase `merge`. These are builtins with no fork, and the ORDER IS BUDGET paragraph records the cost.
  2. **The strip's answer carries verdict flags,** computed inside the same `jq` from the RAW command, `.tool_input.command`, quotes included:
     - Under the cap the answer is `=<flags><US><stripped>`, with `<US>` the unit separator `\u001f`.
     - Over the cap it is `!<bytes>:<kinds>`.

     `<flags>` is a string over `a` (the raw text holds the word `--admin`), `w` (a mutation word) and `p` (a merge path), and two flags only the allowance reads (D-7249): `r` (the raw text holds `--repo`, `-R` or `GH_REPO=`) and `n` (the PR operand is a bare number). A merge head's PR operand is the first word after its `merge`, in the stripped text and before the next separator (`;`, `&&`, `||`, `|` or a newline), that is not an option and not the value of a value-taking option (`--match-head-commit`, `--subject` or `-t`, `--body` or `-b`, `--body-file` or `-F`, `--author-email` or `-A`, `--repo` or `-R`). `n` is set only when the command holds at least one merge head and every merge head has an operand that is all digits. A head with no operand leaves `n` unset, because gh then picks the PR from the branch. The walk stops at each separator, so it never crosses one, and it is linear in the words of the segment. Both flags are computed in the same `jq`, with no new call. `<kinds>` is a comma-separated subset of `merge`, `admin` and `api`.
  3. **The bypass question is asked of every session** after wave 2's question.
     - Under the cap it is denied when:
       - (the stripped command matches `GH_MERGE_RE`, and `a` is set); or
       - (the stripped command matches the new `GH_API_RE`, and `w` or `p` is set).
     - Over the cap it is denied when `<kinds>` holds `admin` or `api`.
  4. **One project may keep `--admin`, by the operator's allowance (D-7249).** The operator ruled on 2026-10-28 that one hosted project keeps landing its PRs by admin merge. This plan names no project.
     - The allowance is a regular file, `$REG/admin-merge-allowed/<project>`. It lives in a dotless registry subdirectory, the pools precedent, so it never collides with a `$REG/<id>.<x>` field. Nothing in the tree writes it; the operator creates it by hand. Its content is not read.
     - The hook reads the session's project with its own registry reader, `_ct_read "$REG/$id.project"`. The value must pass the hook's own project check (`CCRC_PROJ_CLASS`, at most `CCRC_PROJ_MAX` characters), which admits no `/`, so it can never walk out of the directory. An absent or empty `.project` is not allowed. The hook never falls back to the session id here, as its card's project probe does. The hook then checks the allowance with `[[ -f "$f" && ! -L "$f" ]]`. It makes no fork and no `jq` call.
     - Under the allowance, the admin half of the bypass question does not deny for a session of that project. That holds only when `n` is set and `r` is not: the command names the PR by a bare number and names no other repository. A PR named by URL or by branch is refused under the allowance. gh takes the repository from a URL, and it resolves a branch name itself, which the hook cannot check. The `gh api` half is still refused, and wave 2's question is still asked first, so a held worker is still refused.
     - Over the cap the allowance does not apply, because the hook cannot read the repository flags there.
     - A project file that is absent, unreadable, empty or fails the project check, and an allowance that is a symlink or not a regular file, each read as not allowed. That fails closed.
     - The reason text does not mention the allowance.
- **The wide reading, on purpose (D-7111).** Once a real `gh … pr … merge` head or `gh … api` head is present, the deny reads `--admin`, the mutation words and the paths from the whole raw command, not from the merge's own segment.
  - The strip deletes quoted spans, so a quoted flag, a quoted path or a quoted GraphQL query would otherwise be invisible. A per-segment rule also misses a `$(…)` argument, a backslash-newline and a repeated `-X` (the plan review's findings).
  - The cost is that a command holding a real merge head and an unrelated `--admin` mention is refused, for example a merge then `git commit -m "never --admin"` in one command. The reason says so, and the cost is tested.
- **No GET exemption (D-7112).** A `GET …/pulls/<n>/merge` is refused like any other call to that path. `gh pr view <n> --json state,mergedAt` answers the same question, and the reason names it. Exempting GET from text would let `-X GET -X PUT`, or a GET written inside a quoted field, through.
- **Precedence.**
  - Wave 2's wave-hold and child-marker reason is asked first, and its text is unchanged. Over the cap it fires only when `<kinds>` holds `merge`.
  - The bypass reason covers what wave 2's does not.
- **What passes unparsed, said rather than hidden (D-7114).** Each class is measured passing, listed in the hook header's "WHAT PASSES UNPARSED" list, and pinned as a LISTED pass:
  - a query or body read from a file (`-F query=@file`, `--input file.json`, `cat f | gh api graphql --input -`);
  - a word or path assembled at run time (`q="merge""PullRequest"`, a path in a variable built from pieces);
  - a variable or quoted command word (`$GH api …`, `"gh" api …`);
  - a `gh alias`;
  - under the operator's allowance only, a working directory in another repository's checkout, set by a `cd` in the same command or in an earlier one, because the Bash tool keeps its directory between calls (D-7249);
  - ways to move `main` that are not merges, out of this wave's scope and named as such: `gh api -X PATCH repos/<o>/<r>/git/refs/heads/<b>`, the GraphQL `updateRef`, `updateRefs` and `createCommitOnBranch` mutations, and `git push` to a protected branch.
- **What it never touches:**
  - every other `gh` call: `gh pr view`, `gh pr checks`, `gh pr merge <n> --disable-auto`, and every read of the landing verdict;
  - the operator's own shell, which runs no hook (R9's break-glass: the operator's shell or GitHub's UI).

No server, wire, PWA, skill or `ccd` verb change.

**Tech Stack:** bash 5.2, jq 1.7 (Oniguruma), TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, these parts:
- §5.2: "The merge gate becomes a mechanism" (the deny, its mutation rows, "the hook denies the spellings it can parse"), "Operator configuration" (R9) and the rollout order's step 4;
- §4's Coordinator row;
- §6's `ccd/session-hook.sh` row;
- §11, items 10 and 12;
- §12's `--admin` row.

**Other sources:**
- The ledger, `docs/superpowers/programs/landing-order.md`:
  - row 2b, whose dependencies hold: the queue ruleset, approvals at 0, the proof run, and wave 3d, which is #1096, merged and deployed 2026-10-21;
  - the operator's ruling of 2026-10-21 12:15, "Wave 2b is not planned until wave 3d makes the lane ignore a landed PR's removal", which 3d's merge satisfies;
  - ruling 5.
- The arm's own header in `ccd/session-hook.sh`, whose paragraph "Denying `--admin` to EVERY session, and a `gh api` merge … is wave 2b's" this wave replaces.
- `server/test/session-hook-merge-deny.test.ts`: its harness, its spelling lists, its cap cases and its jq-`as` checker.

**Plan review.** Three Opus lenses (spec fidelity, executability, safety) reviewed the first draft, with a Sonnet refuter per serious finding. They found:
- one critical gap: the case-sensitive prefilter;
- 13 important and 8 minor findings, none refuted.

This revision answers all of them. A second Opus pass confirmed them, and found 4 important and 4 minor problems in the revision. A third pass confirmed those, and found 1 important and 6 minor more. All of them are folded in.

**Prerequisite:**
1. **The operator confirms the deny's fleet-wide reach before dispatch.** The hook has no project scope, so a session in any hosted project that still lands with `--admin` would be refused. Ruling 5 already forbids that to every coordinator. Before dispatch the coordinator measures, privately and read-only, which hosted projects' rules still need `--admin` to land, and puts the list to the operator. The list never goes in this public repository.
   - **Answered 2026-10-28.** One project keeps landing by admin merge, with the operator's express permission, through the allowance (D-7249). The operator changes the other projects' notes that tell sessions to merge with `--admin` or through `gh api`. The coordinator confirms that the allowance file exists, by `ls` only, before the live check.
2. **Dispatch after wave 3e (#1127) merges.** Its worker's claim holds `README.md`, which Task 3 edits.

This wave's workspace is a fresh child from `main`.

## Global Constraints

- **Public repository.** Fixtures keep the test file's neutral `demo-quiet-basin` and `o/r`.
- **The hook's contract on every path:** exit 0, a silent stderr, and at most one PreToolUse envelope. The test file's `bash()` asserts all three on every call.
- **One strip per payload, and no new jq.** The arm still runs `MERGE_STRIP_JQ` exactly once and adds no other `jq` call. The hook makes other `jq` calls per event. So the pin compares a merge payload with the same payload made free of every trigger word: the second skips the arm, and the difference in `jq` invocations must be exactly 1 (Task 1).
- **Bounded time.**
  - Every new test over the raw command is a fixed-string `contains` or a linear `test` with no backtracking class.
  - No new walk crosses a separator.
  - Over the cap, only fixed-string splits and `contains`, plus wave 2's bounded word matches, run. No `splits(` regex call is added.
  - The cap-sized adversarial cases stay inside their existing bounds.
- **Every jq `as $name` binding is parenthesised on its own** (the file's jq-1.8 checker), and its binding census is updated.
- **The generated helper block is never edited by hand** (`hook-helpers-generated.test.ts`).
- **Line citations.** The hook's line numbers are cited by README and by the compaction-card corpus. Run the citation and docs-parity suites, and re-ground any moved anchor by its name.
- **Run suites in the foreground**, one file per process, with a timeout of at least 600000 ms.
- **Repo-wide guards in every task:**
  - every `session-hook*` suite;
  - `citations`, `docs-parity`, `compact-card*` and `hook-helpers-generated`;
  - `single-definition/*`, `single-definition-pin`, `topology-clean`, `deviation-refs` and `typecheck-tests`.
- **Fixture HOMEs only.** No real `gh` runs; the hook reads text.
- **Branch discipline and mutations:** as for every wave. Each guard has a measured red, and every mutation is restored from a saved copy.
- **Deviation numbers are issued, never chosen.** This plan's own are D-7111 to D-7116. A departure found while executing it goes in the wave-done mail, and the coordinator numbers it.

## Review Focus

1. **The coordinator's landing still passes in a session with no hold and no marker.** These spellings are extracted verbatim from the skill, by anchor, never retyped:
   - clause 15's `gh pr merge <n> --match-head-commit <handoffCommit>`;
   - every backticked `gh` command under `ccd/coordinator-skill/references/wave-lifecycle.md`'s paragraph **Landing on a native-queue project** (in `## 5`): the rules read, `gh pr checks <pr> --required`, the queue read-back `gh api graphql -F o='{owner}' … mergeQueueEntry …`, `gh pr merge <pr> --disable-auto` and `gh pr view <pr> --json state,headRefOid`;
   - the landing verdict block's `gh api` reads, wherever the merged wave 3e text puts them.

   A false refusal here stops every landing on the fleet.
2. **The two mutation words with no lowercase `merge` are refused** from a fixture HOME whose path holds no `merge`, under the cap and over it.
3. **Every `--admin` spelling the raw text can show is refused in every session**, except in a session of the one project the operator allows (D-7249). There, only an `--admin` on a PR named by a bare number, in a command that names no other repository, passes. The refusal covers a flag before or after the number, `--admin=true`, a quoted `'--admin'` or `"--admin"`, an `--admin` after a `$(…)` argument, and one after a backslash-newline.
4. **Every spelling of the six endpoints in the raw text is refused.** That is any method on either path, quoted or bare, and each mutation word in `-f`, `--raw-field` or a `--input -` heredoc, over the cap too. The unread classes are LISTED passes, not silent ones.
5. **Text is not a command, and the wide reading's cost is named.**
   - Under the cap, commit messages, PR bodies, heredocs and mail texts that name `--admin` or a mutation word pass when no real merge or api head is present. Over the cap the hook cannot parse, so such a text is refused in every session with the split-or-rephrase reason. That is wave 2's accepted over-cap cost, now for every session (D-7115).
   - A command with a real head and an unrelated mention is refused. The reason explains it, and a test pins it.

---

### Task 1: The verdict flags, the prefilter and the admin deny

**Files:**
- Modify:
  - `ccd/session-hook.sh`: the prefilter; `MERGE_STRIP_JQ`'s `capped` answer and the new flags; the bash parse of `mout`; the bypass question; the reason text;
  - the hook's header paragraphs that become false: "Denying `--admin` to EVERY session, and a `gh api` merge … is wave 2b's"; "A session with neither — a coordinator's own, the operator's — is never asked"; the cap section's "Only where the deny already applies: … never refused, under the cap or over it"; THE COST; and the WHAT PASSES UNPARSED list. A new header paragraph states the operator's allowance: its path, that nothing in the tree writes it, what it lifts and what it never lifts;
  - `server/test/session-hook-merge-deny.test.ts`, including two wave 2 titles that this wave makes false. These are "lets a coordinator's enqueue through — a session with no wave hold and no child marker is never asked" and "refuses only where the deny applies: a session with no wave hold and no marker is never asked", reworded to "…is never asked the wave-2 question".

**Interfaces:**
- Produces:
  - the answer format `=<flags><US><stripped>` and `!<bytes>:<kinds>`;
  - the bash split: `mflags=${mout%%$'\x1f'*}`, then `mcmd=${mout#*$'\x1f'}` under the cap; and `mover=${mout#!}`, `mkinds=${mover#*:}`, `mover=${mover%%:*}` over it;
  - the reason, beginning `ccrc: \`--admin\` and \`gh api\` merges are refused in every session`;
  - the over-cap bypass reason. It gives both byte counts and says the hook cannot tell prose from a command over the cap. It names the ways out: split the command, write the text with the Write tool and pass it as a file (`--body-file`, `ccrc-api mail send --json <file>`), and R9's door. It never says that landing is the operator's alone.

  The reason names:
  - the queue landing, `gh pr merge <n> --match-head-commit <sha>`;
  - `gh pr view <n> --json state,mergedAt` for the merged-or-not read;
  - R9's door, the operator's own shell or GitHub's UI;
  - that the whole command is read once it holds a merge or api command.

- [ ] **Step 1: The failing cases.** These go in a new `describe('the bypass deny (wave 2b)')` whose fixture HOME is `mkTmp('ccrc-bypass-')`, asserting `expect(home).not.toContain('merge')`. The file's `bash()` helper gains an optional payload `cwd`, default the fixture HOME as today, for the allowance's cwd cases:
  - `refuses --admin in a session with no hold and no marker`: `gh pr merge 42 --admin` is denied, and the reason contains the four names above.
  - `refuses every parseable merge spelling with --admin inserted after merge`: wave 2's spelling list, each entry rewritten with `.replace(/\bmerge /, 'merge --admin ')`, and an assertion that every entry changed (`gh pr merge --auto 42` included). Every one is denied, with no hold. In wave 2's comment entry the first `merge ` is inside the `#` comment, so that entry is denied through the raw reading. That is noted in the case.
  - `refuses the --admin spellings the raw text shows`: `gh pr merge --admin 42`, `gh pr merge 42 --admin=true`, `gh pr merge 42 '--admin'`, `gh pr merge 42 "--admin"`, `gh pr merge 42 --match-head-commit "$(git rev-parse HEAD)" --admin`, `gh pr merge $(echo 42) --admin` and `gh pr merge 42 \\\n  --admin`.
  - `a worker's --admin still reads as the worker deny`: with `WAVE_HOLD`, the reason is wave 2's, byte for byte.
  - `the coordinator's landing passes`: no hold, the clause 15 spelling extracted from `ccd/coordinator-skill/SKILL.md`, and `--disable-auto`. `deny === null`.
  - `the wide reading's cost, named`: `gh pr merge 42 --match-head-commit <sha> && git commit -m "never --admin"` is denied, and the reason says the whole command is read.
  - `mentions with no merge head pass`: wave 2's mention list, which has three texts naming `--admin`, passes with no hold. So do `echo --admin`, `grep -- --admin docs` and `gh pr view 42 --json mergedAt`.
  - `the answer format`: a direct jq run of `MERGE_STRIP_JQ`, extracted from the hook as the test file already does for its checker, over three commands. The flags and the kinds come out as specified. Five more commands pin `r` and `n`: `gh pr merge 42 --admin` (`n`), `gh pr merge --match-head-commit 4242 ws/alpha --admin` (no `n`: the number is the option's value), `gh pr merge --subject 42 https://github.com/o/r/pull/7 --admin` (no `n`), `gh pr merge 42 -R o/other --admin` (`n` and `r`) and `GH_REPO=o/x gh pr merge 42 --admin` (`n` and `r`). Two more pin the separator rule, each with no `n`: `gh pr merge --admin;echo 42`, and `gh pr merge 42 --admin; gh pr merge https://github.com/o/other/pull/7 --admin`. A loop over all eleven spellings of the value-taking options (`--match-head-commit`, `--subject`, `-t`, `--body`, `-b`, `--body-file`, `-F`, `--author-email`, `-A`, `--repo`, `-R`) runs `gh pr merge <opt> 42 ws/alpha --admin`, and none sets `n`.
  - `the operator's allowance lets --admin through for that one project`: with `$REG/admin-merge-allowed/proj-a` a regular file and the session's `.project` reading `proj-a`, `gh pr merge 42 --admin --match-head-commit <sha>` passes. These are each still denied:
    - the same command with `--repo o/other`, with `-R o/other`, and after `GH_REPO=o/other`;
    - the PR named by URL, `gh pr merge https://github.com/o/other/pull/7 --admin`, and by branch, `gh pr merge ws/alpha --admin`;
    - a bare-number merge followed by a URL merge in one command, and `gh pr merge --admin;echo 42`;
    - a session whose project is `proj-b`;
    - a session whose `.project` reads `proj-b` while the payload's cwd is a directory named `proj-a`;
    - a `.project` reading `../admin-merge-allowed/proj-a`, which would reach the real allowance file without the project check;
    - an allowance that is a symlink to a regular file, or a directory;
    - an unreadable `.project`, an empty one, and an absent one while an allowance file named after the session's own id stands;
    - `gh pr merge 42 --admin; gh api -X PUT repos/o/r/pulls/42/merge` under the allowance, so the lifted admin half is present and only the api half can deny;
    - the over-cap form of the allowed command;
    - with `WAVE_HOLD`, which gives wave 2's reason byte for byte.
  - `one strip per payload`: a `jq` wrapper first on PATH counts invocations. A merge command costs exactly one more than the same command with its trigger words replaced, and that one invocation carries `--argjson cap`.

- [ ] **Step 2: Run; see the new cases fail.** `(cd server && ./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts)`. Wave 2's cases still pass.

- [ ] **Step 3: Implement** the widened prefilter, the flags, the parse, the question and the reason, and rewrite the header paragraphs.

- [ ] **Step 4: Run the file and the repo-wide guards; see them pass.**

- [ ] **Step 5: Mutations**

  | # | Mutation | Expected red |
  |---|---|---|
  | A1 | drop the bypass question | every admin refusal |
  | A2 | read `--admin` from the stripped command instead of the raw | the quoted and `$(…)` cases |
  | A3 | ask the bypass question before wave 2's | the worker's-reason case |
  | A4 | `a` set only for `--admin` after the number | `gh pr merge --admin 42`, and the inserted-after-merge list case |
  | A6 | the flags computed in a separate `jq` call | the one-strip case |
  | A7 | the allowance ignores `--repo`, `-R` and `GH_REPO=` | the other-repository cases |
  | A8 | the allowance check follows a symlink (`-f` alone) | the symlink case |
  | A9 | the allowance also lifts the `gh api` half | the api-under-allowance case |
  | A10 | the allowance read from the cwd's project, not the registry's | the cwd-named-`proj-a` case |
  | A11 | the allowance accepts a PR URL | the URL case |
  | A12 | no project check on the project value | the `../admin-merge-allowed/proj-a` case |
  | A13 | the allowance accepts a branch name | the branch case |
  | A14 | the allowance file read for any project, not the session's | the `proj-b` case |
  | A15 | `n` taken from the first merge head only | the bare-number-then-URL case |
  | A16 | the operand walk crosses a separator | the `--admin;echo 42` case |
  | A17 | an absent `.project` falls back to the session id | the absent-project case |

- [ ] **Step 6: Commit:** `feat(hook): refuse gh pr merge --admin in every session (landing order wave 2b, Task 1)`.

### Task 2: The `gh api` deny, the cap and the listed passes

**Files:**
- Modify: `ccd/session-hook.sh` (`GH_API_RE`, which is `GH_MERGE_RE`'s head grammar with `api` in place of `pr … merge`, derived from its text, plus the `w` and `p` flags and the `api` kind) and `server/test/session-hook-merge-deny.test.ts`.

**Interfaces:**
- Consumes: Task 1's answer format and question.
- Produces:
  - `GH_API_RE`;
  - the mutation-word set, `mergePullRequest`, `enqueuePullRequest`, `enablePullRequestAutoMerge` and `mergeBranch`, written once in the jq program;
  - the path tests `pulls/[^[:space:]/]+/merge` (end-bounded) and `repos/[^[:space:]/]+/[^[:space:]/]+/merges` (end-bounded). They run on the raw text with every `'` and `"` removed first, so `pulls/"$n"/merge` and `pulls/42/'merge'` are paths. The quote characters are spelled through `$q` inside the single-quoted program.

- [ ] **Step 1: The failing cases**, in the same describe:
  - `refuses each mutation word, the two with no lowercase merge included`:
    - `gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`, then the same for `enablePullRequestAutoMerge`, `mergePullRequest` and `mergeBranch`;
    - `--raw-field query=…`;
    - `gh api graphql --input - <<'EOF'`, with the word on a body line.

    Each is denied with no hold.
  - `refuses either path by any method`:
    - `gh api -X PUT repos/o/r/pulls/42/merge`, `gh api --method PUT "repos/{owner}/{repo}/pulls/42/merge"`, `gh api repos/o/r/pulls/42/merge -f merge_method=squash`;
    - `gh api -X GET -X PUT repos/o/r/pulls/42/merge`, `gh api -X PUT repos/o/r/pulls/42/merge -f commit_title='-X GET'`, `gh api --method GET repos/o/r/pulls/42/merge`;
    - `gh api -X POST repos/o/r/merges -f base=main -f head=x`;
    - `gh api -X PUT repos/o/r/pulls/"$n"/merge` and `gh api -X PUT repos/o/r/pulls/42/'merge'`.

    Each is denied.
  - `passes every read of the landing route`: every Review Focus 1 command, each extracted verbatim by its anchor, with `deny === null`. Also `gh api repos/o/r/pulls/42`, `gh api repos/o/r/pulls/42/merges/x` (not end-bounded, so not the path) and a `query { … mergeQueueEntry … }`.
  - `a mutation word or path in text with no gh api head passes`: `git commit -m "never call enqueuePullRequest by hand"`, a heredoc PR body naming every word and both paths, and a mail body naming them.
  - `the wide reading's cost, named`: `gh api repos/o/r/pulls/42; echo enqueuePullRequest` is denied, with the reason's sentence.
  - `LISTED passes, so a later change updates the list`: `gh api graphql -F query=@mutation.graphql`, `gh api graphql --input body.json`, `q="merge""PullRequest"; gh api graphql -f query="mutation { $q }"`, `$GH api -X PUT repos/o/r/pulls/42/merge`, `"gh" api -X PUT repos/o/r/pulls/42/merge`, `gh alias set m 'api -X PUT'`, `gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=x`, `gh api graphql -f query='mutation { updateRef(input: {refId: "x", oid: "y"}) { clientMutationId } }'` and `git push origin HEAD:main`. Each passes, with the hook header's list naming its class. One more, under the allowance: an allowed session whose payload cwd is another repository's checkout runs `gh pr merge 42 --admin`, and it passes (D-7249).
  - Over the cap, with no hold:
    - an over-cap command holding `gh pr merge 42 --admin` is denied with the split-or-rephrase reason and both byte counts;
    - so is one holding `gh api graphql --input - <<'EOF'` with `enqueuePullRequest` on a body line;
    - so is one holding a multi-line `-f query='mutation {\n enablePullRequestAutoMerge … }'`;
    - one holding neither passes;
    - an over-cap `gh pr merge 42` with no `--admin` passes (wave 2's reading, unchanged);
    - every case answers inside the existing bound.
  - `a held session's over-cap api-only command gets the bypass reason, not wave 2's`.
  - `a held session's over-cap admin merge gets wave 2's reason`: with `WAVE_HOLD`, an over-cap `gh pr merge 42 --admin` reason names the hold.
  - `over the cap, the coordinator's long prose that quotes an admin merge is refused (the named cost)`: with no hold, an over-cap `gh pr create --body '…'` whose body quotes `gh pr merge 42 --admin` gets the split-or-rephrase reason. The reason says the over-cap reading cannot tell prose from a command.
  - `the deny's precedence`: wave 2's two precedence cases (it supersedes a sync advisory; it never replaces the graph gate's deny), re-run with an admin merge and with an api merge.

- [ ] **Step 2: Run; see them fail.**

- [ ] **Step 3: Implement.**
  - The over-cap `admin` kind is wave 2's `ocwords` segment condition plus the raw word `--admin` anywhere in the text.
  - The over-cap `api` kind is a segment, from wave 2's `ocsegs` fixed-string split, holding the word `gh` then the word `api`, read by an `ocafter`-style bounded word match as wave 2's `ocmerge` reads `gh … pr … merge`. It also needs a mutation word, or the fixed string `/merge`, anywhere in the raw text, read with fixed-string `contains`. No `splits(` regex call is added. Over the cap, the fixed `/merge` stands for both paths. Its wider reach is part of the named over-cap cost.
  - An over-cap case adds `gh api -X PUT repos/o/r/pulls/42/merge` to the refused set, and a timing assertion keeps it inside the existing bound.

- [ ] **Step 4: Run the file and the repo-wide guards; see them pass.**

- [ ] **Step 5: Mutations**

  | # | Mutation | Expected red |
  |---|---|---|
  | P0 | drop the api question | every api refusal |
  | P1 | drop `enablePullRequestAutoMerge` from the word set | its case |
  | P2 | read the path from the stripped command | the quoted `--method PUT` case |
  | P3 | an exemption for a `--method GET` anywhere | the `-X GET -X PUT`, quoted-GET and GET cases |
  | P4 | `pulls/…/merge` without its end boundary | the `/merges/x` pass |
  | P5 | over-cap kinds ignore `api` | the over-cap heredoc case |
  | P6 | the api question asked only of wave sessions | every no-hold api case |
  | P7 | the prefilter back to `*merge*` only | the enqueue and auto-merge cases |
  | P8 | over-cap kinds ignore `admin` | the over-cap admin case |
  | P9 | over the cap, wave 2's reason fires without `merge` in the kinds | the held over-cap api case |
  | P10 | over the cap, the bypass reason built before wave 2's | the held over-cap admin case |

- [ ] **Step 6: Commit:** `feat(hook): refuse gh api merge calls in every session (landing order wave 2b, Task 2)`.

### Task 3: README, the gate, the PR and the wave-done; then the deploy and the live check

- [ ] **Step 1: README.** The hook section's merge-deny paragraph replaces "denying `--admin` to every session, or a `gh api` merge, is not shipped" with the bypass deny:
  - what it refuses and where, and what passes;
  - the wide reading and its cost;
  - the listed unread classes;
  - the over-cap reading;
  - the operator's per-project allowance: its path, that nothing writes it, and what it lifts and never lifts (D-7249);
  - R9's door.

  The R1 stdout paragraph's "a `gh api` merge passes it" becomes true to this wave. Re-ground every moved anchor by name.
- [ ] **Step 2: The gate.** Every `session-hook*` suite runs whole, one process per file, in a fixed order, with the repo-wide guards. Then the full server suite once, and `agent` and `pwa` in full. A load flake is re-run in isolation and named.
- [ ] **Step 3: The PR and the wave-done.** Title: `feat(hook): the bypass deny — --admin and gh api merges refused in every session (landing order wave 2b)`. Scan the body for private names before posting.
- [ ] **Step 4: The deploy and the live check (the coordinator's, after the merge).**
  - ccrc's updater carries the hook to every home (AGENT-FIRST). Doctor's hook and skills checks pass, and the installed `~/.cc-sessions/session-hook.sh` is byte-equal to the release tree's.
  - The live check never types a bypass into a live session. The coordinator feeds four PreToolUse payloads to the INSTALLED hook. As the suite does, `HOME` is a fresh fixture directory holding the session's `.generation`, and a stub `tmux` that answers `cc-<fixture id>` is first on PATH, so the hook reads only that HOME:
    - `gh pr merge 1 --admin`;
    - `gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: "0"}) { clientMutationId } }'`;
    - clause 15's spelling;
    - one verdict read.

    It checks that the first two are denied and the last two pass. Nothing reaches `gh`.

---

## Deviations found

Numbers are ISSUED, never chosen; a worker never calls the allocator (worker clause 11). The programme coordinator minted this plan's block, 7111–7116, before the plan landed, and this plan defines all six. A departure found while executing it is named in the wave-done mail, and the coordinator assigns its number when it records the ruling.

- **D-7111** — `raw-read` (Architecture): the spec's deny is "the spellings it can parse". Once a real merge or api head is present, this plan reads `--admin`, the mutation words and the paths from the whole raw command, quotes included. Segment parsing over the stripped text missed quoted flags and paths, `$(…)` arguments, backslash-newlines and repeated method flags. The cost is that a command holding a real head and an unrelated mention is refused. That cost is tested and named in the reason.
- **D-7112** — `no-get-exemption` (Architecture): a `GET` of `…/pulls/<n>/merge` is refused too. `gh pr view <n> --json state,mergedAt` is the substitute, and the reason names it. A text-read GET exemption could be defeated by a later `-X PUT`, or by a GET inside a quoted field.
- **D-7113** — `two-more-endpoints` (Goal): the spec names the pulls merge endpoint and three mutations. This plan adds `mergeBranch` and `repos/<o>/<r>/merges`, which merge into a branch past the queue just as well, under the fleet login's admin bypass.
- **D-7114** — `unread-spellings` (Architecture): these pass unread and are listed and pinned as LISTED passes:
  - a query or body read from a file;
  - a word or path assembled at run time;
  - a variable or quoted command word;
  - a `gh alias`;
  - under the operator's allowance, a working directory in another repository's checkout (D-7249);
  - ways to move `main` that are not merges, which are out of this wave's scope: `gh api -X PATCH repos/<o>/<r>/git/refs/heads/<b>`, the GraphQL `updateRef`, `updateRefs` and `createCommitOnBranch` mutations, and `git push` to a protected branch.

  The hook is a contract the fleet honours, not an access boundary (spec §4).
- **D-7115** — `over-cap-every-session` (Review Focus 5): over the cap the hook cannot parse. An over-cap command whose raw text reads as an admin merge or an api merge is refused in every session, prose included, with the split-or-rephrase reason. Wave 2 accepted that cost for held sessions; this wave extends it to every session. A long PR body or mail that quotes these words is sent as a file (`--body-file`, `--json` from a file) or split.
- **D-7116** — `fleet-reach` (Prerequisite): spec §5.2's rollout step 4 states the arming gate for this repository. The hook has no project scope, so the operator confirms the fleet-wide reach before dispatch, from the coordinator's private measurement.
- **D-7249** — `operator-admin-allowance` (Architecture): spec §5.2 denies `--admin` in every fleet session. On 2026-10-28 the operator ruled that one hosted project keeps landing its PRs by admin merge, because its required approval cannot come from a session. So an operator-written file, `$REG/admin-merge-allowed/<project>`, lifts the admin half of the bypass deny for that project's sessions, and only for a command that names its PR by number and names no other repository. Nothing in the tree writes it. The `gh api` half, the over-cap reading and wave 2's worker deny are untouched. A working directory in another checkout, from a `cd` in this command or an earlier one, is a listed pass under the allowance: the hook is a contract, not an access boundary (R9). Added 2026-10-28, after the plan's approval; the landing-order ledger's Decisions, 2026-10-28 08:00.
