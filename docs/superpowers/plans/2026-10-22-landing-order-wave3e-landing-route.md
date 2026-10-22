# Landing order, wave 3e — the landing route comes from the repository's own rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coordinator land every PR by the route its repository's own rules give, read fresh before each landing, and stop for the operator on every conflict. Today the skill squashes on every repository without a queue, never asks which merge methods the rules allow, and never asks where the required checks live:
- A repository that allows merge commits only, and requires a check from a third-party App, has no correct landing today (the ledger's "2026-10-21 16:41" Why).
- On this repository the four required checks live only in classic protection, so a coordinator that read the rules alone would see none (spec §5.7.7).
- `gh pr checks <pr> --required` exiting 0 does not mean every required check passed: it judges only the checks that have reported (§5.7.3; measured live on this repository while planning, Pre-flight 2).

**Architecture:**
- **The landing verdict.** `references/wave-lifecycle.md` gains a §5b, "The landing route, from the repository's own rules", holding ONE fenced `bash` block marked `# The landing verdict`. Inside a subshell it makes reads 1 to 6 of spec §5.7.1 with `gh`, GETs only, plus the `compare` read under read 3b on a direct route, and prints exactly one line: a route with its method, its licence and its strictness; a wait; a red; a merged PR to prove; or a stop with its reason. It never merges, enqueues or writes a setting. The decision (the method set, the required set, the four check states, the three routes, the approval licence and twelve of the fourteen stops) is code the coordinator runs, not prose it recalls.
- **The prose that acts on each line.** §5b's prose after the block says what this session does with each line, states the approval licence, the no-fallback and no-retry rules, the merge proof on every route, and what a stop does. The merge, the read-back and the disarm stay spellings the coordinator types.
- **Clause 15** gains the merge-method settings in what it never writes, one sentence on the route, and the direct-route spelling. Its route Q sentence stays word for word. README's paraphrase of its never-writes list gains the same phrase.
- **§5 step 3** loses #178's fixed `--squash` spelling and "(plus `--admin` where the repository's ruleset requires it)", and its native-queue paragraph gets §5.7.6's two differences: the queue test is the verdict on the PR's own base, and the discovered required set gates the enqueue. SKILL.md step 6 sends every landing to the verdict, and step 7 sends the last wave's.
- **Tests.** A new `server/test/coordinator-landing-verdict.test.ts` extracts the block and RUNS it against a stub `gh`, one case per route, per check state and per stop the reads decide. `coordinator-skill.test.ts` pins the clause, the census of `gh pr merge` spellings, and §5b's prose against the block's own literals.

No server code, no `ccd` verb, no merge endpoint, no `gh` grant, no hook change, and no count word moves: the clause count stays seventeen.

**Tech Stack:** bash 5.2, jq 1.7, gh 2.45, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.7: 5.7.1 the reads, 5.7.2 the method set, 5.7.3 the required set and the other gates, 5.7.4 the three routes and the approval licence, 5.7.5 the stops, 5.7.6 what does not change, 5.7.7 the measurements this plan's fixtures reproduce;
- §6's last row, the surfaces;
- §11, items 7 to 15;
- §12's rows for a merge-commits-only repository, a required check kept in one source only, the other gates, an unknown rule type, an App check that has not reported, and an `--admin` that could skip a required check.

**Other sources:**
- The programme ledger, `docs/superpowers/programs/landing-order.md`: Decisions, "2026-10-21 16:41 — the landing route from the repository's own rules, ruled", and row 3e's scope cell.
- **The operator's rulings of 2026-10-21, spec §11 items 7 to 15, all as the draft recommended:** squash, then merge (7); a rebase-only repository stops (8); on a 401 or 403 the check set comes from the branch's public protection view, a route that needs strictness, linear history or `enforce_admins` stops, and `--admin` is never used (9); the approval licence stays on both direct routes, stated narrowly, until wave 2b's deny retires it (10); the running-check fix is a separate small server wave, 3f, not this one (11); this wave is planned after wave 3d merges and before wave 2b (12); the amendment is a new §5.7, so §5.2's text stays as wave 3d leaves it (13); rollout is `ccrc rollout --to` the prerelease that carries the merge, then the installed skill text is verified in every home (14); the reads ask about the PR's own base branch, not the literal `main` (15).
- **The written §5.7, approved by the operator on 2026-10-22 and merged in #1092** (`77e1f8efb`). This plan implements it; where the two differ, §5.7 wins and the difference is a deviation.

**Prerequisite:** wave 3d merged (#1096, `e173c1aa`) and deployed (v0.0.541); both hold. This wave's workspace is a fresh child from `main`. The ledger is the coordinator's, not a task here; nothing in it is owed before this wave's PR opens.

## Global Constraints

- **Public repository.** No private host, path, account, lane, person, other project or tracker id goes in code, tests, docs, commits or the PR. Fixtures use neutral names (`third-party-ci`, `ci/app`, `legacy/ci`, `release/2`); this repository's own check names and App id (`test (server)`, `15368`) are public facts of this repository.
- **Skill text is pinned verbatim, and the pin lands in the same commit as the text.** The block and the test that runs it are one commit (Task 1); clause 15, the prose and their pins are one commit (Task 2).
- **The skill pins move with the clauses.** `worker-skill.test.ts`, `coordinator-skill.test.ts` and the clause-count words in `README.md` and `CLAUDE.md` move in the same commit as a clause. This wave adds no clause, so only `CONTRACT[14]` moves; "seventeen" stays in SKILL.md, README.md and CLAUDE.md.
- **No numeric line citation on an added line outside `docs/`** (`server/test/citations.test.ts`). Cite an anchor (`§5b`, `CONTRACT[14]`, a heading), never `wave-lifecycle.md:<n>` or `SKILL.md:<n>`.
- **No repository name in the skill.** Every read in the block spells `repos/{owner}/{repo}`, which `gh` fills from the checkout; the verdict test's `READ` pattern refuses any other argv. The route comes from what the repository answers, never from a list.
- **`EXEC_COMMANDS` stays `['tmux','ccd']`** (`ccrc-api-closed.test.ts`, "EXEC_COMMANDS is exactly tmux and ccd, and names no client"). No `gh` grant, no new merge endpoint, no `ccd` verb.
- **`update-branch` is named once, in clause 15**, to forbid it (`coordinator-skill.test.ts`, the `names update-branch ONLY inside clause 15` case). Nothing this wave adds says it.
- **Every `gh pr merge` spelling binds `--match-head-commit <handoffCommit>`** (the census, Task 2). The disarm `gh pr merge <pr> --disable-auto` is the only exempt span.
- **Install every package's modules once, before Task 1.** `typecheck-tests` compiles `agent/` and `pwa/` (and `pwa/` resolves `@ccrc/ui` from `../ui`), so without their modules it reports inherited errors that hide a real one:

  ```bash
  (cd server && npm ci) && (cd agent && npm ci) && (cd ui && npm ci) && (cd pwa && npm ci)
  ```

- **Run suites in the foreground**, with a timeout of at least 600000 ms, package-local, one file per process: `(cd server && ./node_modules/.bin/vitest run test/<file>)`. Every command block starts at the repository root and leaves the shell there.
- **Fixture HOMEs only.** The verdict test runs the block in a `mkTmp` HOME with a stub `gh` first on `PATH`; the real `gh` is never reached from a test. The one live run this plan allows (Task 1, Step 5) is the block itself, GETs only, against this repository.
- **Branch discipline.** Commit on the workspace's own branch. Never a feature branch, `update-branch`, a rebase or a force push.
- **Each new guard ships with a red.** Every guard in the block and every new pin has a mutation below; the wave-done names each mutation and its red count.
- **Deviation numbers are issued by the coordinator at run-open.** A departure is named in the wave-done mail; a worker never calls the allocator.

## Review Focus

1. **Fail closed: an unreadable answer is a stop, never an absence.** A 404 is "not protected" only with the exact message `Branch not protected`; read 3b without `protection.enabled`, read 4 missing a field, a jq failure, and a read 5 answer the judge cannot classify all stop `unreadable`; an unreadable read 6 counts as able to bypass, and so does a `required_status_checks` rule that names no ruleset, which read 6 cannot ask about. Every `gh` the block's text spells is one of the reads, by an allowlist over that text, so a write under a branch no case reaches is still a red. (Task 1, the `unreadable: …` cases, `the approval licence fails: an unreadable read 6 …`, `… names no ruleset …` and `reads and never writes …`; mutations V4, V10a, V23, V28, V30, V32.)
2. **The required set is a union, judged name by name from read 5, never from gh's exit code.** Classic checks and legacy contexts count (the §5.7.7 lesson); an App-pinned name is satisfied only by that App's run; a pinned name seen only as a status is `unverifiable`; a name nothing reported waits even when `--required` would exit 0; the statuses array is read, never the combined state. (Task 1, the CHECKS cases and `route Q: this repository as measured …`; mutations V5, V6, V13, V22, V24.)
3. **The method set is an intersection, and the routes follow from it.** Every `pull_request` rule narrows; queue methods are lower-cased; linear history is `enabled == true`, never the object's presence; squash before merge; rebase alone, an empty set, a queue method outside the set, two queue methods and auto-merge off under a queue all stop; another gate forces route G. (Task 1, the ROUTES cases and the method stops; mutations V1, V2, V3, V14, V15, V16, V17.)
4. **`--admin` is licensed narrowly, from reads, before the merge.** Only on a direct route, only for a missing approval, never past another gate, never past a review-conversation rule an admin could skip, never over classic checks without `enforce_admins`, never over a ruleset that may be bypassed, never under read 3b, never as a fallback, and a refused merge is never retried. (Task 1, the eight `licence-fails` cases, `licence holds …` and the 3b licence stop; mutations V8, V9, V10b, V19, V31. Task 2, the census and `licenses --admin narrowly …`; mutations T3, T5, T13.)
5. **Route Q stays word for word, on the PR's own base.** Clause 15's queue sentence is unchanged through "which enqueues it"; the queue test reads the base from read 1, never the literal `main`; read 5 runs only once the head is `handoffCommit`; under read 3b route Q reads no `compare` and never stops on a head behind the base, since the queue tests the merged group itself; the discovered set gates the enqueue; the bounded wait has an end and is stated, and its every-check watch runs once. (Task 1, `asks about the PR's own base …`, `reads the head's checks only once …`, `under read 3b reads the compare only for a direct route …`, the bounded-wait cases; mutations V7, V11, V12, V27, V29. Task 2, `keeps route Q word for word …`, the native-queue test and `fixes one bounded foreground wait …`; mutations T1, T9, T10, T15, T16.)

## File Structure

| File | Task | Change |
|---|---|---|
| `ccd/coordinator-skill/references/wave-lifecycle.md` | 1 | a new `### 5b — The landing route, from the repository's own rules`, its intro paragraph and the verdict block, between §5's step 5 and `## 6 — Final merge` |
| `server/test/coordinator-landing-verdict.test.ts` | 1 | new: extracts the block and runs it against a stub `gh`, 67 tests |
| `ccd/coordinator-skill/SKILL.md` | 2 | clause 15; step 6's pointer sentence; step 7's pointer sentence |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | 2 | §5 step 3's "One PR per child" sentence; "Landing on a native-queue project"'s opening parenthesis and enqueue gate; §5b's prose after the block |
| `README.md` | 2 | "merge-method settings, " in the "Landing order (landing-order wave 1)" paragraph's paraphrase of clause 15's never-writes list |
| `server/test/coordinator-skill.test.ts` | 2 | `CONTRACT[14]`; the `gh pr merge` census; the native-queue landing case; a new describe of nine cases |

## Task order

- Task 1, then Task 2, then Task 3. Task 2's new describe slices §5b and reads the block's literals, so it needs Task 1's block.
- Claim each file before its task edits it. Every file here is a skill or a skill pin that other programmes edit too. A 409 names the holder, who is the one to ask; never edit a file another session holds. A worker blocked on a claim pushes what it has, reports which task waits on which claim, and waits. It does not merge `main` to chase a claim.
- No other file is edited. In particular `CLAUDE.md`, README beyond its one phrase, the worker and reviewer skills, `ccd/session-hook.sh` and every server source stay as they are (Pre-flight 10 and 11).

## Pre-flight findings (measured while planning; not deviations)

All counts below were measured 2026-10-22, 06:05Z to 06:40Z, on a prototype of this plan at `cd622b2f6` (`origin/main` then), with only `server/` modules installed, under a load average of about 7.

1. **This repository answers route Q, as §5.7.7 predicts.** The prototype's block, run read-only against this repository, about 3 s a run:

   | PR | Line |
   |---|---|
   | #1118 | `ROUTE Q method=squash admin=never strict=no` (earlier, `WAIT not-reported: test (server)`; Pre-flight 2) |
   | #1115 | `ROUTE Q method=squash admin=never strict=no` |
   | #1116 | `RED test (server) [github-actions]` |
   | #1110 | `MERGED head=1cea2299…` |
   | #1117, with a wrong `handoffCommit` | `STOP not-at-head: …` |

2. **`gh pr checks <pr> --required` exiting 0 is not "every required check passed".** On #1118 at its head, `--required` exited 0 listing three required checks while the fourth, `test (server)`, had not reported: it is the sharded suite's summary job, which GitHub creates only once its shards finish. Today's text ("enqueue once `--required` exits 0") would have enqueued it, and gh would have armed auto-merge instead. So the wait for a name that has not reported watches every check, not only `--required` (Task 1's block, Task 2's `WAIT not-reported` bullet).
3. **A jq failure must never fall through to a route.** A first draft passed a whole check-run payload to `jq --argjson`; #1089's 91 runs with their output text overflowed it (`Argument list too long`), the judge printed nothing, and the draft printed `ROUTE Q` over a red required check. The block slims each read through jq in a pipe under `set -o pipefail`, every jq computation carries `|| stop "unreadable: …"`, and the read-5 `case` ends in a fail-closed `*)` arm (mutation V23).
4. **gh 2.45's error output.** On a non-2xx `gh api` prints GitHub's error body to stdout (with `"status":"404"`), `gh: <message> (HTTP <n>)` to stderr, and exits 1. With `-i`, the status line ends in LF, the headers in CRLF, and a CRLF blank line precedes the body. The block reads read 3's status from the `-i` status line and strips `\r` with `tr -d '\r'` (BSD sed has no `\r`, and the macOS leg runs this test). The stub reproduces all of it.
5. **gh 2.45's `pr checks` has no timeout flag.** `--interval` is valid only with `--watch`; `--fail-fast` exists; there is no `--json`. A pending check exits 8 (gh's source; the help text does not say so). A bound on a watch is therefore the Bash tool's timeout, and the bound on a name that never reports is the block's own `BOUND_S` loop.
6. **Several check runs can share one name** on one head, even under the endpoint's default `filter=latest` (two `map-build` runs from two check suites). Among same-name runs from the named App the judge takes red over pending over passing, so a pass is never called while any same-name run is red. §5.7.3 does not rank them; this is the plan's reading.
7. **A `sleep` inside a subshell loop runs under the Bash tool.** The bounded wait re-polls with `sleep "$POLL_S"` inside the block's loop, only when `BOUND_S` is above 0. A foreground `sleep` command alone can be refused by Claude Code's Bash tool; measured while planning, 2026-10-22, `( end=$((SECONDS + 2)); while [ "$SECONDS" -lt "$end" ]; do sleep 1; done; echo ok )` ran and printed its line. Task 1, Step 5 re-measures it in the worker's own session.
8. **Where the block lives: §5b, after §5's step 5.** Inside step 3's numbered list a 167-line fence would need list indentation and would split "One PR per child" from "Landing on a native-queue project". Every existing slice anchor (`**Landing on a native-queue project**` … `**Same project:**`, `## 6 — Final merge`, step 3's numbering) is untouched.
9. **The verdict's test is a new file, outside the one test §6's surface row names: a ruled departure, named in the wave-done** (the coordinator's ruling 6 of 2026-10-22: the file is ruled in). The stub, the fixtures and 60 cases are about 390 lines, which would double the weight of a `coordinator-skill.test.ts` that is already 2977 lines. CI selects it by `.github/ci/select-tests.mjs`'s Rule 1, NEW: `if (!inMap || (changedHere && (changedHere.status === 'A' || changedHere.status === 'M')))`, so a live test file the map has no entry for, or one the change adds or modifies, is selected, and a new file is both. Measured 2026-10-22, 07:03Z, by calling `selectTests` with a map that has no entry for the file: it answers `{"file":"server/test/coordinator-landing-verdict.test.ts","rule":1,…}` both when the change adds the file and when only `wave-lifecycle.md` changes; with an entry whose `read` holds `wave-lifecycle.md`, a change to that file selects it by rule 3 (READ). A change under `ccd/coordinator-skill/` is not a full-suite trigger. Task 3, Step 2 still checks that the PR's `select tests` summary lists the file.
10. **The coordinator's rulings of 2026-10-22 on this plan's literal readings, which bind it:**
    - (a) Under read 3b, "the head is behind the base" stops the DIRECT routes (G and U) only (ruling 1). §5.7.1 stops "if the route would need one of them: the PR's head is behind the base (… so land-sync would depend on strictness)", and route Q never needs strictness: the queue tests the merged group itself. So on route Q under read 3b the block reads no `compare`; the `method = merge` stop under read 3b stays on every route. Pinned by `under read 3b reads the compare only for a direct route …` and mutation V29.
    - (b) Licence condition 2 is met by order (ruling 2): the verdict reaches a route only once every required name passes, so a pending check is a `WAIT`, never `licence-fails`.
    - (c) An approval required only in classic protection, with `enforce_admins` on, satisfies all three conditions, so the verdict answers `admin=licensed` (ruling 3); as §5.7.4 says, `--admin` does not help there, and GitHub's refusal is the stop. The prose beside the licence says so.
    - (d) The block stops `unreadable` on a base outside `[A-Za-z0-9._/-]`, because the base goes into a URL path (ruling 4). It is a ruled departure, named in the wave-done as a stop §5.7.1 does not list; it has a red (V27).
    - (e) Under full read 3 with `strict=yes` the block reads no `compare` (ruling 5): land-sync stays clause 15's existing rule, which is what "applies as it does today" says.
    - (f) **Ruled in by the coordinator (2026-10-22), a departure from §5.7.3's list of other gates.** It adds stops and never a merge. Licence condition 3 says `--admin` cannot skip a gate, and two gates an admin can skip are on no list in §5.7.3: a ruleset `pull_request` rule's `required_review_thread_resolution`, which the bypass the licence relies on skips with the approval, and classic `required_conversation_resolution.enabled` without `enforce_admins`. Measured by review against the draft's block with a stub `gh`: each answered `ROUTE U method=squash admin=licensed strict=no`. The block makes either one `licence-fails` (the conversation-resolution statement, after the other-gates stop) and leaves the route as it was, so a non-admin direct merge is still allowed. Two `licence-fails` cases and mutation V31. The wave-done names it as a departure.
    - (g) **Ruled in by the coordinator (2026-10-22), a stop §5.7.5 does not list: `verdict-unread`.** The block has no per-call time limit, so a run the Bash tool cuts off, or one that does not parse, prints nothing (plan review, safety lens). §5b's list of verdict words now ends with "Anything else … is the stop `verdict-unread`", so silence, two lines or an unlisted word never becomes a route chosen by hand. Pinned in `lists exactly the stops …`; mutation T18. The wave-done names it as a departure.
11. **Left as they are, and listed for the ledger:**
    - The server's dequeue brief (`renderDequeueBrief`, `landing.ts`) still spells the route Q re-enqueue and cites clause 15; that stays true. `landing-verdict` 28 and `pr-queue-lane` 29 pass unchanged.
    - Review 759's F1 rewording ("within a second of the merge, either side") touches ccd, the spec, README and `prstate.ts`, not a skill; it stays with "a later wave".
12. **Counts that do not move.** No count word (no new clause); the `update-branch` equality stays at 1; `citations` 4 passed; `install-coordinator-skill` 24 and `wrapper-roster-fixture` 17 (no new reference file, so `REQUIRED_REFS` is unchanged).
13. **`typecheck-tests` was not run on the prototype**: only `server/` modules were installed (`Cannot find module 'typescript'` from `pwa/`). Run directly, `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit` reported 4 errors, all inherited from `../agent/src/server.ts` (`ws` not installed), and none in either test file this plan writes. With all four packages installed it is expected to pass, as on wave 3d (`12 passed (12)`).

---

### Task 1: The landing verdict, and the test that runs it

**Model routing:** `sonnet`, effort `high`. The block decides how every PR on every project lands.

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`: insert §5b directly after §5's step 5 (`grep -n '^5. Dispatch wave N+1 (§2, step 2) only after' ccd/coordinator-skill/references/wave-lifecycle.md`, the item and its continuation line) and directly before `## 6 — Final merge`, with one blank line on each side.
- Create: `server/test/coordinator-landing-verdict.test.ts`.

**Interfaces:**
- Consumes: `gh` 2.45 (`pr view --json`, `api`, `api --paginate`, `api -i`), jq 1.7, bash; `mkTmp` from `server/test/tmpHelpers.ts`.
- Produces: the block, marked `# The landing verdict`, with `<pr>` and `<handoffCommit>` placeholders and two tunables, `BOUND_S` (default 0: never wait) and `POLL_S` (default 30). It prints exactly one line:

  | Line | Meaning |
  |---|---|
  | `ROUTE Q method=<m> admin=never strict=<s>` | the native queue; enqueue with no method flag |
  | `ROUTE G method=<m> admin=<licensed\|never> strict=<s>` | a gated direct merge |
  | `ROUTE U method=<m> admin=<licensed\|never> strict=<s>` | an ungated direct merge |
  | `MERGED head=<sha>` | already merged: go to the merge proof |
  | `WAIT pending: <names>` | a reported required check is still running |
  | `WAIT not-reported: <names>` | a required name has not reported yet |
  | `RED <name> [github-actions\|app <id>\|status], …` | a required check is red, with its kind |
  | `STOP <reason>: <what it read>` | one of twelve reasons: `unreadable`, `read-3b-unknowable`, `not-at-head`, `unknown-rule-type`, `method-set-empty`, `rebase-only`, `queue-method-not-allowed`, `two-queue-methods`, `auto-merge-off`, `unverifiable`, `not-reported`, `licence-fails` |

  `<s>` is `yes`, `no`, or `unknown` (read 3b only). The three stops no read decides, `red-unreachable`, `verdict-unread` and `github-refused`, are Task 2's prose.

How the fourteen stops of §5.7.5 land:

| §5.7.5 stop | Where |
|---|---|
| A source is unreadable | `unreadable` (reads 1, 2, 3, 3b, 4, 5, the approval read and the compare read on a direct route) |
| Read 3b leaves the route unknowable | `read-3b-unknowable` (the method is merge, the head is behind on a direct route, or the licence is weighed) |
| The PR is not at the reviewed head | `not-at-head` (head differs, or CLOSED); MERGED prints `MERGED`, never a stop |
| An unknown rule type | `unknown-rule-type` |
| The method set is empty | `method-set-empty` |
| Rebase is the only method | `rebase-only` |
| The queue's method is not allowed | `queue-method-not-allowed` |
| Two queue methods | `two-queue-methods` |
| Auto-merge is off under a queue rule | `auto-merge-off` |
| A required check cannot be verified | `unverifiable` |
| Not reported within the bound | `not-reported` (only with `BOUND_S` above 0) |
| A red nothing here can reach | `RED … [app <id>]` or `[status]`, then Task 2's prose stop `red-unreachable` |
| The approval licence fails | `licence-fails` (also a `required_status_checks` rule that names no ruleset, and a review-conversation rule an admin could skip: Pre-flight 10(f), ruled in) |
| GitHub refuses the merge | Task 2's prose stop `github-refused` |
| (not in §5.7.5) The verdict was not read: no line, more than one, or an unlisted first word | Task 2's prose stop `verdict-unread` (Pre-flight 10(g), a ruled departure) |

- [ ] **Step 1: Write the failing test**

Create `server/test/coordinator-landing-verdict.test.ts` with exactly this text. Its parts:
- the block extraction (every ```` ```bash ```` fence in `wave-lifecycle.md` holding `# The landing verdict`; there must be exactly one) and the placeholder substitution (`<pr>` → 42, `<handoffCommit>` → a fixture sha);
- the stub `gh`: an executable first on `PATH`, keyed per read on its argv, answering from fixture files with per-call sequences for the bounded wait, exit 1 with GitHub's error body on stdout and `gh: fixture (HTTP <n>)` on stderr for any non-200, gh's `-i` format for read 3, and exit 90 on any argv it does not know;
- the starting fixture `measured()`, which is this repository as §5.7.7 measured it (squash only, a queue rule merging by `SQUASH`, the four classic checks at App 15368 with `enforce_admins` on, approvals 0, statuses empty with a combined `pending`), plus a non-required red `map-build`, a `skipped` required conclusion and check runs over two pages;
- `bare()` (no rule, not protected, every method, nothing reported), `preQueue` (this repository before its queue: a ruleset approval of one, auto-merge off), `thirdParty` (merge commits only, an App check in a ruleset: the motivating repository) and `via3b` (read 3 answers 403);
- 15 ROUTES cases, 9 CHECKS cases, 35 STOPS cases, the `licence holds` case, and seven named tests: 67 tests.

````ts
// Landing-order wave 3e (spec 2026-09-23 §5.7): the coordinator lands a PR by the route the repository's own rules
// give, read fresh before each landing. `references/wave-lifecycle.md` §5b carries ONE fenced bash block, the landing
// verdict: it makes reads 1 to 6 with gh and prints exactly one line, a route with its method and its licence, a
// wait, a red, a merged PR to prove, or a stop with its reason. It never merges.
//
// This file extracts that block and RUNS it, against a stub gh that answers fixture JSON per read, with one case per
// route and per stop the reads decide (§5.7.5). The fixture every case starts from is this repository as measured on
// 2026-10-21 (§5.7.7), which must still answer route Q. A comment is a request; a red suite is a mechanism: the skill's
// prose says what the coordinator does with each line, and this file is what holds the line itself in place.
//
// The stub is an executable `gh` first on PATH in a fixture HOME. It logs every argv and answers an argv it does not
// know with exit 90, so a block that reached for anything but the six reads fails closed.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wl = readFileSync(path.join(root, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
const MARK = '# The landing verdict';
const blocks = [...wl.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => b.includes(MARK));

const HC = 'c0ffee'.padEnd(40, '0');
const ACTIONS = { id: 15368, slug: 'github-actions' };
const OTHER_APP = { id: 999, slug: 'third-party-ci' };
const CLASSIC = ['test (server)', 'test (agent)', 'test (pwa)', 'build-pwa'];

/** One gh answer. `raw` is written as is; otherwise `body` is JSON. A code other than 200 makes gh exit 1, as gh does
 *  on any non-2xx, with GitHub's error body on stdout (measured: gh prints it there and its message on stderr). */
type Answer = { code: number; body?: unknown; raw?: string };
type Key = 'pr' | 'rules' | 'protection' | 'branch' | 'repo' | 'compare' | 'checkruns' | 'status' | 'ruleset';
type Fixture = Partial<Record<Key, Answer | Answer[]>>;

const ok = (body: unknown): Answer => ({ code: 200, body });
const fail = (code: number, message = 'Server Error'): Answer => ({ code, body: { message, status: String(code) } });
const run = (name: string, conclusion: string | null = 'success', status = 'completed', app: unknown = ACTIONS) =>
  ({ name, status, conclusion: status === 'completed' ? conclusion : null, app, output: { text: 'x'.repeat(64) } });
const pages = (...ps: unknown[]): Answer => ({ code: 200, raw: ps.map((p) => JSON.stringify(p)).join('\n') });
const runs = (...rs: unknown[]): Answer => ok({ total_count: rs.length, check_runs: rs });

/** This repository on 2026-10-21 (§5.7.7): squash only, a queue rule merging by SQUASH, the four classic checks at
 *  one App id with `enforce_admins` on, no approval required, and a head with no commit status at all. */
const measured = (): Fixture => ({
  pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: '' }),
  rules: ok([
    { type: 'pull_request', ruleset_source_type: 'Repository', ruleset_id: 11, parameters: {
      required_approving_review_count: 0, allowed_merge_methods: ['merge', 'squash', 'rebase'] } },
    { type: 'merge_queue', ruleset_source_type: 'Repository', ruleset_id: 11, parameters: { merge_method: 'SQUASH' } },
  ]),
  protection: ok({
    required_status_checks: { strict: false, contexts: CLASSIC, checks: CLASSIC.map((c) => ({ context: c, app_id: 15368 })) },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { required_approving_review_count: 0 },
    required_linear_history: { enabled: false },
    required_signatures: { enabled: false },
  }),
  repo: ok({ allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, allow_auto_merge: true,
    allow_update_branch: false }),
  // Two pages, as `--paginate` prints them, and a NON-required red beside the four required greens.
  checkruns: pages(
    { total_count: 5, check_runs: [run('test (server)'), run('test (agent)'), run('map-build', 'failure')] },
    { total_count: 5, check_runs: [run('test (pwa)'), run('build-pwa', 'skipped')] }),
  status: ok({ state: 'pending', statuses: [] }),
});

/** No ruleset, no classic protection, every method allowed: the ungated repository. */
const bare = (): Fixture => ({
  ...measured(),
  rules: ok([]),
  protection: fail(404, 'Branch not protected'),
  repo: ok({ allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, allow_auto_merge: false }),
  checkruns: runs(),
});

/** gh's `-i` output: the status line, headers ending in CRLF, a blank CRLF line, then the body (measured 2.45.0). */
const included = (a: Answer): string => a.raw ?? (`HTTP/2.0 ${a.code} X\nX-Github-Request-Id: 0\r\nX-Xss-Protection: 0\r\n\r\n`
  + JSON.stringify(a.body));

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$FX/calls"
case "$*" in
  "pr view "*) k=pr ;;
  "api --paginate repos/{owner}/{repo}/rules/branches/"*) k=rules ;;
  "api -i repos/{owner}/{repo}/branches/"*/protection) k=protection ;;
  "api repos/{owner}/{repo}/branches/"*) k=branch ;;
  "api repos/{owner}/{repo}") k=repo ;;
  "api repos/{owner}/{repo}/compare/"*) k=compare ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/check-runs) k=checkruns ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/status) k=status ;;
  "api repos/{owner}/{repo}/rulesets/"*) k=ruleset ;;
  *) echo "fixture gh: unexpected argv: $*" >&2; exit 90 ;;
esac
n=$(( $(cat "$FX/$k.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FX/$k.n"
p="$FX/$k"; [ -f "$FX/$k.$n.out" ] && p="$FX/$k.$n"
[ -f "$p.out" ] || { echo "fixture gh: no answer for $k" >&2; exit 91; }
cat "$p.out"
rc=$(cat "$p.rc")
[ "$rc" = 0 ] || echo "gh: fixture (HTTP $(cat "$p.code"))" >&2
exit "$rc"
`;

type Result = { out: string; calls: string[]; stderr: string };

function verdict(fx: Fixture, env: Record<string, string> = {}): Result {
  const home = mkTmp('ccrc-landing-verdict-');
  const bin = path.join(home, 'bin');
  const dir = path.join(home, 'fx');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), STUB, { mode: 0o755 });
  writeFileSync(path.join(dir, 'calls'), '');
  for (const [k, v] of Object.entries(fx) as [Key, Answer | Answer[]][]) {
    const seq = Array.isArray(v) ? v : [v];
    seq.forEach((a, i) => {
      const stem = path.join(dir, Array.isArray(v) && i < seq.length - 1 ? `${k}.${i + 1}` : k);
      const text = k === 'protection' ? included(a) : (a.raw ?? JSON.stringify(a.body ?? null));
      writeFileSync(`${stem}.out`, text);
      writeFileSync(`${stem}.rc`, a.code === 200 ? '0' : '1');
      writeFileSync(`${stem}.code`, String(a.code));
    });
  }
  const script = blocks[0]!.replace(/<pr>/g, '42').replace(/<handoffCommit>/g, HC);
  const r = spawnSync('bash', ['-c', script], {
    cwd: home, encoding: 'utf8', timeout: 15000,
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, FX: dir, ...env },
  });
  const calls = readFileSync(path.join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
  return { out: r.stdout, calls, stderr: r.stderr };
}

/** Each case: what changes from its starting fixture, and the ONE line the verdict must print. */
type Case = [name: string, fx: () => Fixture, line: string, env?: Record<string, string>];

const with_ = (base: () => Fixture, patch: Fixture | ((f: Fixture) => Fixture)) => (): Fixture => {
  const f = base();
  return typeof patch === 'function' ? patch(f) : { ...f, ...patch };
};
const rules = (...rs: unknown[]): Fixture => ({ rules: ok(rs) });
const pull = (params: Record<string, unknown>, id = 11) =>
  ({ type: 'pull_request', ruleset_id: id, parameters: { required_approving_review_count: 0, ...params } });
const queue = (method: string, id = 11) => ({ type: 'merge_queue', ruleset_id: id, parameters: { merge_method: method } });
const rsc = (checks: unknown[], id = 21, strict = false) => ({ type: 'required_status_checks', ruleset_id: id,
  parameters: { strict_required_status_checks_policy: strict, required_status_checks: checks } });
const settings = (squash: boolean, merge: boolean, rebase: boolean, auto = false): Fixture =>
  ({ repo: ok({ allow_squash_merge: squash, allow_merge_commit: merge, allow_rebase_merge: rebase, allow_auto_merge: auto }) });
const classicGreen = (): Answer => runs(...CLASSIC.map((c) => run(c)));
/** The configuration this repository had before its queue (§5.7.7, recorded in the wave 2 plan): a ruleset approval
 *  of one, the four classic checks binding an admin, classic approvals 0, auto-merge off. */
const preQueue = with_(measured, (f) => ({ ...f,
  ...rules(pull({ required_approving_review_count: 1 })), ...settings(true, false, false, false),
  pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }),
  checkruns: classicGreen() }));
const thirdParty = with_(bare, { ...rules(pull({ allowed_merge_methods: ['merge'] }), rsc([{ context: 'ci/app', integration_id: 999 }])),
  ...settings(false, true, false), checkruns: runs(run('ci/app', 'success', 'completed', OTHER_APP)) });
const via3b = with_(bare, { protection: fail(403, 'Resource not accessible by integration'),
  branch: ok({ name: 'main', protection: { enabled: false } }), compare: ok({ behind_by: 0, ahead_by: 1 }) });

const ROUTES: Case[] = [
  ['route Q: this repository as measured (§5.7.7), the four classic checks gating the enqueue', measured,
    'ROUTE Q method=squash admin=never strict=no'],
  ['route Q: a paginated rules answer printed as two arrays is still one rule set',
    with_(measured, { rules: { code: 200, raw: JSON.stringify([pull({})]) + JSON.stringify([queue('SQUASH')]) } }),
    'ROUTE Q method=squash admin=never strict=no'],
  ['route G: merge commits only and a third-party App check in a ruleset (the motivating repository)', thirdParty,
    'ROUTE G method=merge admin=never strict=no'],
  ['route G: the pre-queue configuration lands under the approval licence (§5.7.7)', preQueue,
    'ROUTE G method=squash admin=licensed strict=no'],
  ['route G: an approval that is given licenses nothing', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'APPROVED' }) })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: another gate (a required workflow) and no required check', with_(bare, rules({ type: 'workflows', ruleset_id: 5, parameters: {} })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: a strict ruleset makes the repository strict-protection',
    with_(bare, { ...rules(rsc([{ context: 'build-pwa' }], 21, true)), checkruns: runs(run('build-pwa')) }),
    'ROUTE G method=squash admin=never strict=yes'],
  ['route G: a legacy context no App is named for passes on a commit status', with_(bare, {
    protection: ok({ required_status_checks: { strict: false, contexts: ['legacy/ci'], checks: [{ context: 'legacy/ci', app_id: null }] },
      enforce_admins: { enabled: false }, required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    status: ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'success' }] }) }),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G under read 3b: the check set from the branch view, strictness unknown', with_(via3b, {
    branch: ok({ name: 'main', protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone',
      contexts: ['build-pwa'], checks: [{ context: 'build-pwa', app_id: 15368 }] } } }), checkruns: runs(run('build-pwa')) }),
    'ROUTE G method=squash admin=never strict=unknown'],
  ['route U: no rule, branch not protected, nothing required, and nothing waits', bare,
    'ROUTE U method=squash admin=never strict=no'],
  ['route U: squash, then merge (§11 item 7), and a pull_request rule with no allowed_merge_methods allows all three',
    with_(bare, { ...rules(pull({})), ...settings(false, true, true) }), 'ROUTE U method=merge admin=never strict=no'],
  ['route U: EVERY pull_request rule narrows the set, not only the first',
    with_(bare, rules(pull({ allowed_merge_methods: ['squash', 'merge'] }, 1), pull({ allowed_merge_methods: ['merge'] }, 2))),
    'ROUTE U method=merge admin=never strict=no'],
  ['route U: a classic required_linear_history object that is not enabled removes nothing', with_(bare, {
    ...settings(false, true, false), protection: ok({ required_linear_history: { enabled: false }, enforce_admins: { enabled: true } }) }),
    'ROUTE U method=merge admin=never strict=no'],
  ['route U under read 3b: confirmed unprotected, head level with the base', via3b,
    'ROUTE U method=squash admin=never strict=unknown'],
  ['an already MERGED PR goes to the merge proof, not to a stop', with_(measured, {
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'MERGED', reviewDecision: '' }) }), `MERGED head=${HC}`],
];

const CHECKS: Case[] = [
  ['a required check still running waits', with_(measured, { checkruns: runs(run('test (server)', null, 'in_progress'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), 'WAIT pending: test (server)'],
  ['a required name that has not reported waits, though gh pr checks --required would exit 0 (measured 2026-10-22)',
    with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'WAIT not-reported: test (server)'],
  ['a check run from another App does not satisfy a name pinned to the Actions App',
    with_(measured, { checkruns: runs(run('test (server)', 'success', 'completed', OTHER_APP), run('test (agent)'),
      run('test (pwa)'), run('build-pwa')) }), 'WAIT not-reported: test (server)'],
  ['a commit status pending on an unpinned context waits, though the combined state is never read', with_(bare, {
    ...rules(rsc([{ context: 'legacy/ci' }])), status: ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'pending' }] }) }),
    'WAIT pending: legacy/ci'],
  ['a required Actions check red on the head', with_(measured, { checkruns: runs(run('test (server)', 'failure'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), 'RED test (server) [github-actions]'],
  ['a required App check red on the head, which no rerun reaches', with_(thirdParty, {
    checkruns: runs(run('ci/app', 'action_required', 'completed', OTHER_APP)) }), 'RED ci/app [app 999]'],
  ['a required commit status in error', with_(bare, { ...rules(rsc([{ context: 'legacy/ci' }])),
    status: ok({ state: 'failure', statuses: [{ context: 'legacy/ci', state: 'error' }] }) }), 'RED legacy/ci [status]'],
  ['the bounded wait: a name that never reports within the bound is a stop',
    with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'STOP not-reported: test (server) within 1s', { BOUND_S: '1', POLL_S: '1' }],
  ['the bounded wait: a name that reports within the bound is read again, and lands', with_(measured, (f) => ({ ...f,
    checkruns: [runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')), classicGreen()] })),
    'ROUTE Q method=squash admin=never strict=no', { BOUND_S: '30', POLL_S: '1' }],
];

const STOPS: Case[] = [
  ['unreadable: read 1 fails', with_(measured, { pr: fail(502) }), 'STOP unreadable: read 1'],
  ['unreadable: read 2 is not a 200', with_(measured, { rules: fail(500) }), 'STOP unreadable: read 2'],
  ['unreadable: read 3 answers 404 Branch not found, the same status with another meaning',
    with_(measured, { protection: fail(404, 'Branch not found') }), 'STOP unreadable: read 3 answered 404'],
  ['unreadable: read 3 answers 404 Not Found', with_(measured, { protection: fail(404, 'Not Found') }),
    'STOP unreadable: read 3 answered 404'],
  ['unreadable: read 3 answers 500', with_(measured, { protection: fail(500) }), 'STOP unreadable: read 3 answered 500'],
  ['unreadable: read 3 does not answer at all', with_(measured, { protection: { code: 0, raw: '' } }),
    'STOP unreadable: read 3 answered nothing'],
  ['unreadable: read 3 answers 403 and read 3b fails', with_(via3b, { branch: fail(500) }),
    'STOP unreadable: read 3b, after read 3 answered 403'],
  ['unreadable: read 3b answers without protection.enabled, which is never read as unprotected',
    with_(via3b, { branch: ok({ name: 'main' }) }), 'STOP unreadable: read 3b, after read 3 answered 403'],
  ['unreadable: read 1 names a base outside the characters a branch path is read with', with_(measured, {
    pr: ok({ baseRefName: 'main?x=1', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) }),
    'STOP unreadable: read 1 gave no usable base'],
  ['unreadable: read 4 is not a 200', with_(measured, { repo: fail(500) }), 'STOP unreadable: read 4'],
  ['unreadable: read 4 lacks a merge setting, which is never read as false', with_(measured, {
    repo: ok({ allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false }) }), 'STOP unreadable: read 4'],
  ['unreadable: read 5 check runs are not a 200', with_(measured, { checkruns: fail(500) }), 'STOP unreadable: read 5'],
  ['unreadable: read 5 statuses are not a 200', with_(measured, { status: fail(500) }), 'STOP unreadable: read 5'],
  ['read 3b leaves the route unknowable: the method is merge', with_(via3b, settings(false, true, false)),
    'STOP read-3b-unknowable: read 3 answered 403 and the method is merge'],
  ['read 3b leaves the route unknowable: the head is behind the base', with_(via3b, { compare: ok({ behind_by: 2 }) }),
    'STOP read-3b-unknowable: read 3 answered 403 and the head is 2 behind the base'],
  ['read 3b leaves the route unknowable: the admin licence would be weighed', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 })),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }) })),
    'STOP read-3b-unknowable: an approval is missing and read 3 answered 403'],
  ['the PR is not at the reviewed head', with_(measured, {
    pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) }),
    `STOP not-at-head: the PR head is ${'f'.repeat(40)}`],
  ['the PR is CLOSED', with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'CLOSED', reviewDecision: '' }) }),
    'STOP not-at-head: the PR is CLOSED'],
  ['an unknown rule type', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH'),
    { type: 'file_path_restriction', ruleset_id: 3, parameters: {} }) })), 'STOP unknown-rule-type: file_path_restriction'],
  ['the method set is empty: the settings and a pull_request rule share nothing',
    with_(bare, { ...rules(pull({ allowed_merge_methods: ['merge'] })), ...settings(true, false, false) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['the method set is empty: a ruleset requires linear history over merge commits only',
    with_(bare, { ...rules({ type: 'required_linear_history', ruleset_id: 4 }), ...settings(false, true, false) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['the method set is empty: classic protection requires linear history over merge commits only', with_(bare, {
    ...settings(false, true, false), protection: ok({ required_linear_history: { enabled: true }, enforce_admins: { enabled: true } }) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['rebase is the only method (§11 item 8)', with_(bare, settings(false, false, true)),
    'STOP rebase-only: rebase is the only method left'],
  ['the queue method is not allowed', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('MERGE')) })),
    'STOP queue-method-not-allowed: the queue merges by merge and the method set is ["squash"]'],
  ['two queue methods', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH', 11), queue('MERGE', 12)) })),
    'STOP two-queue-methods: merge,squash'],
  ['auto-merge is off under a queue rule (a precaution, §5.7.5)', with_(measured, settings(true, false, false, false)),
    'STOP auto-merge-off: a merge_queue rule applies'],
  ['a required check cannot be verified: a name pinned to an App shows only as a commit status', with_(measured, {
    checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')),
    status: ok({ state: 'success', statuses: [{ context: 'test (server)', state: 'success' }] }) }),
    'STOP unverifiable: test (server) shows only as a commit status'],
  ['the approval licence fails: another gate an admin could skip', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }) })),
    'STOP licence-fails: an approval is missing and --admin could skip code_scanning'],
  ['the approval licence fails: classic signatures are another gate', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, required_signatures: { enabled: true } }) })),
    'STOP licence-fails: an approval is missing and --admin could skip classic required_signatures'],
  ['the approval licence fails: enforce_admins is off over the classic checks', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, enforce_admins: { enabled: false } }) })),
    'STOP licence-fails: an approval is missing and enforce_admins is off over the classic checks'],
  ['the approval licence fails: a ruleset with required checks the login may bypass', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    ruleset: ok({ id: 21, current_user_can_bypass: 'pull_requests_only' }) })),
    'STOP licence-fails: an approval is missing and ruleset 21 answers pull_requests_only'],
  ['the approval licence fails: an unreadable read 6 counts as able to bypass', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    ruleset: fail(404, 'Not Found') })),
    'STOP licence-fails: an approval is missing and ruleset 21 answers unreadable'],
  ['the approval licence fails: a required_status_checks rule that names no ruleset has no read 6, so counts as able to bypass',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), { type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'build-pwa', integration_id: 15368 }] } }),
    ruleset: ok({ id: 21, current_user_can_bypass: 'never' }) })),
    'STOP licence-fails: an approval is missing and a required_status_checks rule names no ruleset'],
  ['the approval licence fails: a ruleset requires review threads resolved, which the bypass skips with the approval',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: true })) })),
    'STOP licence-fails: an approval is missing and --admin could skip conversation resolution'],
  ['the approval licence fails: classic conversation resolution without enforce_admins', with_(preQueue, (f) => ({ ...f,
    protection: ok({ required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: false },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }) })),
    'STOP licence-fails: an approval is missing and --admin could skip conversation resolution'],
];

const LICENSED_NEVER: Case = ['the approval licence holds: every ruleset with required checks answers never', with_(preQueue, (f) => ({ ...f,
  ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
  ruleset: ok({ id: 21, current_user_can_bypass: 'never' }) })), 'ROUTE G method=squash admin=licensed strict=no'];

/** Every argv the block may send: the six reads (and the compare under read 3b), as GETs. */
const READ = /^(pr view 42 --json baseRefName,headRefOid,state,reviewDecision|api (--paginate |-i )?repos\/\{owner\}\/\{repo\}(\/[^\s]*)?)$/;
/** The same reads as the block's TEXT spells them, from the word `gh` to the end of its quoted path, followed only by
 *  the close of its `$(…)`, a pipe, or a line continuation. An allowlist, so a write under a branch no case reaches
 *  is still a red: `gh pr review`, `gh api --method=PATCH …` and `gh api -XPATCH …` match none of it. */
const GH_SPELLED = /^gh (pr view "\$PR" --json baseRefName,headRefOid,state,reviewDecision\)|api (--paginate |-i )?"repos\/\{owner\}\/\{repo\}[^"\s]*"(?=\)|\s+\||\s+\\$))/;

describe('the landing verdict block (landing-order wave 3e, spec §5.7)', () => {
  it('wave-lifecycle.md carries exactly one landing verdict block', () => {
    expect(blocks, 'references/wave-lifecycle.md must carry exactly one fenced bash block marked "# The landing verdict"')
      .toHaveLength(1);
  });

  it('reads and never writes: every gh the block spells is one of the reads, with no GraphQL and no rm', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const spelled = [...b.matchAll(/\bgh\b/g)].map((m) => b.slice(m.index).split('\n')[0]!);
    expect(spelled.length, 'the block spells fewer gh reads than its nine').toBeGreaterThanOrEqual(9);
    for (const s of spelled) expect(s, 'the block spells a gh that is not one of the reads').toMatch(GH_SPELLED);
    expect(b).not.toContain('graphql');
    expect(b).not.toMatch(/\brm\s/);
  });

  it('under read 3b reads the compare only for a direct route: route Q needs no strictness, so a head behind the base lands', () => {
    expect(blocks).toHaveLength(1);
    const q = verdict(with_(via3b, { ...rules(pull({}), queue('SQUASH')), ...settings(true, false, false, true),
      compare: ok({ behind_by: 2 }) })());
    expect(q.out, `stderr: ${q.stderr}`).toBe('ROUTE Q method=squash admin=never strict=unknown\n');
    expect(q.calls.filter((c) => c.includes('/compare/')), 'route Q under read 3b read the compare').toEqual([]);
    for (const c of q.calls) expect(c, 'the block sent gh something other than a read').toMatch(READ);
    // A direct route under read 3b still reads it, once.
    expect(verdict(via3b()).calls.filter((c) => c.includes('/compare/')))
      .toEqual([`api repos/{owner}/{repo}/compare/main...${HC}`]);
  });

  it.each([...ROUTES, ...CHECKS, ...STOPS, LICENSED_NEVER])('%s', (_name, fx, line, env) => {
    expect(blocks).toHaveLength(1);
    const r = verdict(fx(), env);
    expect(r.out, `stderr: ${r.stderr}`).toBe(`${line}\n`);
    for (const c of r.calls) expect(c, 'the block sent gh something other than a read').toMatch(READ);
  });

  it('asks about the PR\'s own base, never the literal main (§11 item 15)', () => {
    const r = verdict(with_(bare, { pr: ok({ baseRefName: 'release/2', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) })());
    expect(r.out).toBe('ROUTE U method=squash admin=never strict=no\n');
    expect(r.calls).toContain('api --paginate repos/{owner}/{repo}/rules/branches/release/2');
    expect(r.calls).toContain('api -i repos/{owner}/{repo}/branches/release/2/protection');
    expect(r.calls.filter((c) => c.includes('branches/main'))).toEqual([]);
  });

  it('reads the head\'s checks only once read 1 has shown the head is handoffCommit', () => {
    const r = verdict(with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) })());
    expect(r.calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision']);
  });

  it('weighs read 6 only for the licence, and only for a ruleset that carries required checks', () => {
    expect(verdict(preQueue()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(measured()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(LICENSED_NEVER[1]()).calls.filter((c) => c.includes('/rulesets/')))
      .toEqual(['api repos/{owner}/{repo}/rulesets/21']);
  });

  it('re-reads only read 5 while it waits within the bound', () => {
    const r = verdict(with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) })(),
      { BOUND_S: '2', POLL_S: '1' });
    expect(r.out).toBe('STOP not-reported: test (server) within 2s\n');
    expect(r.calls.filter((c) => c.endsWith('/check-runs')).length).toBeGreaterThanOrEqual(2);
    expect(r.calls.filter((c) => c.startsWith('pr view'))).toHaveLength(1);
  });
});
````

- [ ] **Step 2: Run it and record the red**

Run: `(cd server && ./node_modules/.bin/vitest run test/coordinator-landing-verdict.test.ts)`

Expected on `main`'s `wave-lifecycle.md`: `Tests  67 failed (67)` (predicted, not measured). Every case and every named test asserts the one block first, so each fails on that `toHaveLength(1)`. Measured on the prototype as `61 failed (61)` before its last two STOPS cases (`… read 3b answers without protection.enabled …`, `… read 1 names a base outside …`) were added; both assert the block first too, and so do the four this plan added after the prototype (the route Q compare test, the no-ruleset case and the two conversation-resolution cases). The `reads and never writes` test must fail here as well: it asserts the block before inspecting it, so it cannot pass on an empty block (the prototype's first red was `60 failed | 1 passed` until that assertion went in).

- [ ] **Step 3: Insert §5b's heading, its intro and the block**

Insert this text, exactly, at the place **Files** names. The prose that follows the block is Task 2's.

````markdown
### 5b — The landing route, from the repository's own rules

Before every landing, on every project, this session reads the PR's repository
and lands only by the route its rules give (spec 2026-09-23 §5.7). The reads
run fresh each time, never from memory, because the operator can change any of
them between two PRs. They are the block below, the **landing verdict**: run it
from your own session, in a checkout of the PR's repository, with `<pr>` and
`<handoffCommit>` filled in. It makes GETs only, prints exactly one line, and
never merges, enqueues or writes a setting.

```bash
( # The landing verdict (spec 2026-09-23 §5.7). GETs only: it never merges, enqueues or writes a setting.
PR=<pr> HC=<handoffCommit>
BOUND_S=${BOUND_S:-0} POLL_S=${POLL_S:-30} route=
set -o pipefail
say() { printf '%s\n' "$1"; exit 0; }
stop() { say "STOP $1"; }

# Read 1: the base, the head, the state and the review decision, from the PR itself.
r1=$(gh pr view "$PR" --json baseRefName,headRefOid,state,reviewDecision) || stop "unreadable: read 1"
base=$(jq -r .baseRefName <<<"$r1") && head=$(jq -r .headRefOid <<<"$r1") && state=$(jq -r .state <<<"$r1") \
  || stop "unreadable: read 1"
[[ $base =~ ^[A-Za-z0-9._/-]+$ ]] || stop "unreadable: read 1 gave no usable base"
[ "$state" = MERGED ] && say "MERGED head=$head"
[ "$state" = CLOSED ] && stop "not-at-head: the PR is CLOSED"
[ "$head" = "$HC" ] || stop "not-at-head: the PR head is $head"

# Read 2: every rule of every active ruleset on that base. A type this block does not know is a stop.
rules=$(gh api --paginate "repos/{owner}/{repo}/rules/branches/$base" | jq -sc 'add // []') \
  || stop "unreadable: read 2"
unknown=$(jq -r '[.[].type] - ["pull_request", "merge_queue", "required_status_checks", "required_linear_history",
  "workflows", "code_scanning", "required_deployments", "required_signatures", "non_fast_forward", "deletion",
  "creation"] | unique | join(",")' <<<"$rules") || stop "unreadable: read 2"
[ -z "$unknown" ] || stop "unknown-rule-type: $unknown"

# Read 3: classic protection. A 404 is "not protected" only with exactly that message; a 401 or 403 goes to read 3b.
r3=$(gh api -i "repos/{owner}/{repo}/branches/$base/protection")
c3=$(head -n1 <<<"$r3" | cut -d' ' -f2) b3=$(tr -d '\r' <<<"$r3" | sed '1,/^$/d') via=3
case "$c3" in
  200) prot=$(jq -c . <<<"$b3") || stop "unreadable: read 3" ;;
  404) [ "$(jq -r .message <<<"$b3")" = "Branch not protected" ] || stop "unreadable: read 3 answered 404"
       prot='{}' ;;
  401|403) via=3b
       prot=$(gh api "repos/{owner}/{repo}/branches/$base" | jq -c '.protection | if .enabled == true
         then {required_status_checks} elif .enabled == false then {} else error("no enabled") end') \
         || stop "unreadable: read 3b, after read 3 answered $c3" ;;
  *) stop "unreadable: read 3 answered ${c3:-nothing}" ;;
esac

# Read 4: the merge settings. A missing field is unreadable, never false.
r4=$(gh api "repos/{owner}/{repo}" | jq -ce '{allow_squash_merge, allow_merge_commit, allow_rebase_merge,
  allow_auto_merge} as $s | if all($s[]; type == "boolean") then $s else error("missing") end') \
  || stop "unreadable: read 4"

# The method set (§5.7.2): the settings, intersected with EVERY pull_request rule, minus merge under linear history.
methods=$(jq -nc --argjson s "$r4" --argjson r "$rules" --argjson p "$prot" '
  [if $s.allow_squash_merge then "squash" else empty end, if $s.allow_merge_commit then "merge" else empty end,
   if $s.allow_rebase_merge then "rebase" else empty end]
  | reduce ($r[] | select(.type == "pull_request")
      | .parameters.allowed_merge_methods // ["merge", "squash", "rebase"] | map(ascii_downcase)) as $a
      (.; map(select(IN($a[]))))
  | if any($r[]; .type == "required_linear_history") or $p.required_linear_history.enabled == true
    then map(select(. != "merge")) else . end') || stop "unreadable: the method set"
queues=$(jq -r '[.[] | select(.type == "merge_queue") | (.parameters.merge_method // "unknown") | ascii_downcase]
  | unique | join(",")' <<<"$rules") || stop "unreadable: read 2"
if [ -n "$queues" ]; then
  route=Q method=$queues
  [[ $queues == *,* ]] && stop "two-queue-methods: $queues"
  jq -e --arg m "$method" 'any(.[]; . == $m)' <<<"$methods" >/dev/null \
    || stop "queue-method-not-allowed: the queue merges by $method and the method set is $methods"
  [ "$(jq -r .allow_auto_merge <<<"$r4")" = true ] || stop "auto-merge-off: a merge_queue rule applies"
else
  method=$(jq -r 'if any(.[]; . == "squash") then "squash" elif any(.[]; . == "merge") then "merge"
    elif length > 0 then "rebase" else "" end' <<<"$methods") || stop "unreadable: the method set"
  [ -n "$method" ] || stop "method-set-empty: the settings, the pull_request rules and linear history leave none"
  [ "$method" = rebase ] && stop "rebase-only: rebase is the only method left"
fi

# Read 3b knows no linear history and no strictness: the merge method is a stop, and on a direct route so is a head
# behind the base. Route Q needs no strictness (the queue tests the merged group itself), so it reads no compare.
if [ "$via" = 3b ]; then
  [ "$method" = merge ] && stop "read-3b-unknowable: read 3 answered $c3 and the method is merge"
  if [ "$route" != Q ]; then
    behind=$(gh api "repos/{owner}/{repo}/compare/$base...$HC" | jq -e .behind_by) \
      || stop "unreadable: the compare read under read 3b"
    [ "$behind" = 0 ] || stop "read-3b-unknowable: read 3 answered $c3 and the head is $behind behind the base"
  fi
fi

# The required set (§5.7.3): every ruleset's required checks, plus classic checks and legacy contexts. A name an App
# is pinned for keeps its App; the same name unpinned is the same requirement. Then strictness and the other gates.
req=$(jq -nc --argjson r "$rules" --argjson p "$prot" '
  [($r[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]?
     | {context, app: .integration_id}),
   ($p.required_status_checks.checks[]? | {context, app: (if .app_id == -1 then null else .app_id end)}),
   ($p.required_status_checks.contexts[]? | {context: ., app: null})]
  | unique | . as $all
  | map(select(.app != null or (.context as $c | all($all[]; .context != $c or .app == null))))') \
  || stop "unreadable: the required set"
strict=$(jq -nr --argjson r "$rules" --argjson p "$prot" --arg via "$via" '
  if any($r[]; .type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true)
     or $p.required_status_checks.strict == true then "yes" elif $via == "3b" then "unknown" else "no" end') \
  || stop "unreadable: strictness"
gates=$(jq -nr --argjson r "$rules" --argjson p "$prot" '
  [($r[] | select(.type | IN("workflows", "code_scanning", "required_deployments", "required_signatures")) | .type),
   (if $p.required_signatures.enabled == true then "classic required_signatures" else empty end)]
  | unique | join(",")') || stop "unreadable: the other gates"

# Read 5, judged name by name: the head's check runs and its statuses ARRAY, never the combined state.
checks() {
  local cr st
  cr=$(gh api --paginate "repos/{owner}/{repo}/commits/$HC/check-runs" \
    | jq -sc '[.[].check_runs[] | {name, status, conclusion, app: (.app | {id, slug})}]') || { echo unreadable; return; }
  st=$(gh api --paginate "repos/{owner}/{repo}/commits/$HC/status" \
    | jq -sc '[.[].statuses[] | {context, state}]') || { echo unreadable; return; }
  jq -nr --argjson q "$req" --argjson cr "$cr" --argjson st "$st" '
    def runs($x): [$cr[] | select(.name == $x.context and ($x.app == null or .app.id == $x.app))];
    def sts($x): if $x.app == null then [$st[] | select(.context == $x.context)] else [] end;
    def judge($x): runs($x) as $r | sts($x) as $s
      | if $x.app != null and ($r | length) == 0 and any($st[]; .context == $x.context) then "unverifiable"
        elif any($r[]; .status == "completed" and (.conclusion | IN("success", "neutral", "skipped") | not))
          or any($s[]; .state | IN("failure", "error")) then "red"
        elif any($r[]; .status != "completed") or any($s[]; .state == "pending") then "pending"
        elif ($r | length) > 0 or any($s[]; .state == "success") then "passing"
        else "not-reported" end;
    def kind($x): if any(runs($x)[]; .app.slug == "github-actions") then "github-actions"
      elif (runs($x) | length) > 0 then "app \(runs($x)[0].app.id)" else "status" end;
    [$q[] | {x: ., s: judge(.)}] as $j
    | first(("unverifiable", "red", "pending", "not-reported") as $w | select(any($j[]; .s == $w))
        | "\($w) " + ([$j[] | select(.s == $w) | .x.context + (if $w == "red" then " [\(kind(.x))]" else "" end)]
        | join(", "))) // "passing"' || echo unreadable
}
v=$(checks) w=${v%% *}
if [ "$w" = not-reported ] && [ "$BOUND_S" -gt 0 ]; then
  end=$((SECONDS + BOUND_S))
  while [ "$w" = not-reported ] && [ "$SECONDS" -lt "$end" ]; do sleep "$POLL_S"; v=$(checks) w=${v%% *}; done
fi
case "$w" in
  passing) ;;
  unverifiable) stop "unverifiable: ${v#* } shows only as a commit status" ;;
  red) say "RED ${v#* }" ;;
  pending) say "WAIT pending: ${v#* }" ;;
  not-reported) [ "$BOUND_S" -gt 0 ] && stop "not-reported: ${v#* } within ${BOUND_S}s"
                say "WAIT not-reported: ${v#* }" ;;
  *) stop "unreadable: read 5" ;;
esac

# The route (§5.7.4), and the approval licence on a direct route only.
if [ "$route" != Q ]; then
  if [ "$req" != "[]" ] || [ -n "$gates" ]; then route=G; else route=U; fi
fi
admin=never
need=$(jq -nr --argjson r "$rules" --argjson p "$prot" --argjson pr "$r1" '
  (any($r[]; .type == "pull_request" and (.parameters.required_approving_review_count // 0) > 0)
   or ($p.required_pull_request_reviews.required_approving_review_count // 0) > 0)
  and $pr.reviewDecision != "APPROVED"') || stop "unreadable: the approval"
if [ "$route" != Q ] && [ "$need" = true ]; then
  [ "$via" = 3b ] && stop "read-3b-unknowable: an approval is missing and read 3 answered $c3"
  [ -z "$gates" ] || stop "licence-fails: an approval is missing and --admin could skip $gates"
  jq -ne --argjson r "$rules" --argjson p "$prot" 'any($r[]; .type == "pull_request"
      and .parameters.required_review_thread_resolution == true)
    or ($p.required_conversation_resolution.enabled == true and $p.enforce_admins.enabled != true) | not' >/dev/null \
    || stop "licence-fails: an approval is missing and --admin could skip conversation resolution"
  jq -e '((.required_status_checks.checks // []) + (.required_status_checks.contexts // []) | length) == 0
    or .enforce_admins.enabled == true' <<<"$prot" >/dev/null \
    || stop "licence-fails: an approval is missing and enforce_admins is off over the classic checks"
  # Read 6 for every ruleset carrying required checks. A rule naming no ruleset cannot be asked: able to bypass.
  ids=$(jq -r '[.[] | select(.type == "required_status_checks") | .ruleset_id]
    | if all(.[]; type == "number") then unique | .[] else error("no ruleset id") end' <<<"$rules") \
    || stop "licence-fails: an approval is missing and a required_status_checks rule names no ruleset"
  for id in $ids; do
    by=$(gh api "repos/{owner}/{repo}/rulesets/$id" | jq -r .current_user_can_bypass) || by=unreadable
    [ "$by" = never ] || stop "licence-fails: an approval is missing and ruleset $id answers $by"
  done
  admin=licensed
fi
say "ROUTE $route method=$method admin=$admin strict=$strict"
)
```
````

- [ ] **Step 4: Run the tests**

```bash
(cd server && ./node_modules/.bin/vitest run test/coordinator-landing-verdict.test.ts)
(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/wrapper-roster-fixture.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts)
```

Expected: `coordinator-landing-verdict` 67 passed (67) (the prototype measured 63 on its 63-test file; this plan's block and test file, as written here, were run once in a scratch tree on 2026-10-22, 07:05Z, and passed 67 of 67). Measured on the prototype: `coordinator-skill` 169 passed (169), unchanged with the block in place; `citations` 4; `install-coordinator-skill` 24; `wrapper-roster-fixture` 17; `docs-parity` 54.

- [ ] **Step 5: Two live measurements, read-only**

(a) **The bounded loop under your own Bash tool.** Run, as one Bash call with a 20000 ms timeout:

```bash
( end=$((SECONDS + 2)); n=0; while [ "$SECONDS" -lt "$end" ]; do sleep 1; n=$((n+1)); done; echo "loop ok n=$n" )
```

Expected: `loop ok n=2` (Pre-flight 7). If the tool refuses it, replace the block's `sleep "$POLL_S"` with `read -rt "$POLL_S" <> <(:) || :`, re-run Step 4 (the two bounded-wait cases and `re-reads only read 5 …` exercise it), and name the substitution in the wave-done.

(b) **The block against this repository** (optional, GETs only, the block's own reads). From the repository root, take the block with `sed -n '/^( # The landing verdict/,/^)$/p' ccd/coordinator-skill/references/wave-lifecycle.md`, put an open PR's number and its current `headRefOid` in place of `<pr>` and `<handoffCommit>`, and run it. Expected: one line, `ROUTE Q method=squash admin=never strict=no`, a `WAIT …` or a `RED …` (Pre-flight 1). Anything else — above all a `STOP` other than `not-at-head` — is reported in the wave-done with the line, before Task 2.

- [ ] **Step 6: Mutations, then commit**

Each is one edit of the block in `wave-lifecycle.md`, run against `coordinator-landing-verdict.test.ts` alone, then restored byte for byte (`cmp` against a copy taken before the first mutation). Every count in this table is the prototype's: V1 to V26 measured on its 61-test file, V23, V27 and V28 on its 63-test file. V29 to V32 are this plan's own, added after the prototype, and their counts are predicted, not measured. None is an expected value: the worker re-measures EVERY mutation on the final 67-test file and reports each measured count beside the prototype's in the wave-done, naming every one that differs. One is predicted to differ: V2, since the route Q compare test enqueues by `SQUASH` too.

| # | Edit | Prototype's count |
|---|---|---|
| V1 | only the first `pull_request` rule narrows: `reduce ($r[] \| select(.type == "pull_request")` becomes `reduce (first($r[] \| select(.type == "pull_request"))` | 1 failed: `route U: EVERY pull_request rule narrows the set …` |
| V2 | delete `\| ascii_downcase` from the `queues=` line | 15 failed (16 predicted on the final file, not measured: the route Q compare test too) |
| V3 | `$p.required_linear_history.enabled == true` becomes `$p.required_linear_history != null` | 1 failed: `route U: a classic required_linear_history object that is not enabled …` |
| V4 | the 404 arm drops its message test: `404) prot='{}' ;;` | 2 failed: the `Branch not found` and `Not Found` cases |
| V5 | replace the two `$p.required_status_checks…` lines of `req=` (the `checks[]?` line and the `contexts[]?` line, which ends in the array's `]`) with the one line `   empty]`, so the array still closes and jq still compiles | 11 failed |
| V6 | the judge's `else "not-reported" end` becomes `else "passing" end` | 4 failed |
| V7 | delete `[ "$head" = "$HC" ] \|\| stop "not-at-head: …"` | 2 failed: `the PR is not at the reviewed head`, `reads the head's checks only once …` |
| V8 | delete `[ -z "$gates" ] \|\| stop "licence-fails: … could skip $gates"` | 2 failed: the `code_scanning` and classic-signatures licence cases |
| V9 | delete the `jq -e '…enforce_admins…' … \|\| stop "licence-fails: … enforce_admins is off …"` statement | 1 failed |
| V10a | `\|\| by=unreadable` becomes `\|\| by=never` | 1 failed: `… an unreadable read 6 counts as able to bypass` |
| V10b | `[ "$by" = never ]` becomes `[ "$by" != always ]` | 2 failed: the two read-6 `licence-fails` cases |
| V11 | `rules/branches/$base` becomes `rules/branches/main` | 1 failed: `asks about the PR's own base, never the literal main …` |
| V12 | `if [ "$w" = not-reported ] && [ "$BOUND_S" -gt 0 ]; then` becomes `if false; then` | 2 failed: `… a name that reports within the bound …`, `re-reads only read 5 …` |
| V13 | the judge's first test becomes `if false then "unverifiable"` | 1 failed: `a required check cannot be verified …` |
| V14 | `if [ "$req" != "[]" ] \|\| [ -n "$gates" ]; then route=G` drops `\|\| [ -n "$gates" ]` | 1 failed: `route G: another gate (a required workflow) …` |
| V15 | the fixed order picks `merge` before `squash` | 9 failed |
| V16 | delete the `auto-merge-off` line | 1 failed |
| V17 | delete the `two-queue-methods` line | 1 failed |
| V18a | delete the 3b `… the method is merge` stop | 1 failed |
| V18b | `[ "$behind" = 0 ]` becomes `true` | 1 failed |
| V19 | delete `[ "$via" = 3b ] && stop "read-3b-unknowable: an approval is missing …"` | 1 failed |
| V22 | remove `"skipped"` from the judge's passing set | 2 failed |
| V23 | delete the read-5 `case`'s `*) stop "unreadable: read 5" ;;` arm | 2 failed (on 63) |
| V24 | `runs($x)` drops `and ($x.app == null or .app.id == $x.app)` | 1 failed: `a check run from another App does not satisfy …` |
| V26 | add a comment line `# then gh pr merge` inside the block | 1 failed: `reads and never writes …` |
| V27 | delete the `[[ $base =~ … ]] \|\| stop "unreadable: read 1 gave no usable base"` line | 1 failed (on 63) |
| V28 | read 3b's `elif .enabled == false then {} else error("no enabled") end` becomes `else {} end` | 1 failed (on 63) |
| V29 | the 3b section's `if [ "$route" != Q ]; then` becomes `if true; then`, so the behind-the-base stop applies to route Q again | 1 failed, predicted, not measured: `under read 3b reads the compare only for a direct route …` |
| V30 | the `ids=` filter's `if all(.[]; type == "number") then unique \| .[] else error("no ruleset id") end` becomes `map(numbers) \| unique \| .[]`, the draft's silent drop | 1 failed, predicted, not measured: `… a required_status_checks rule that names no ruleset …` |
| V31 | delete the `jq -ne … required_review_thread_resolution … \|\| stop "licence-fails: … could skip conversation resolution"` statement (its four lines) | 2 failed, predicted, not measured: the two conversation-resolution cases |
| V32 | after `[ "$state" = CLOSED ] && stop …`, insert the line `[ "$state" = DRAFT ] && gh pr review "$PR" --approve`, a write under a branch no case reaches | 1 failed, predicted, not measured: `reads and never writes …` (the draft's denylist passed this edit) |

(V20, V21 and V25 were drafted on the prototype and dropped before measurement; the numbering is the prototype's.)

```bash
git add ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-landing-verdict.test.ts
git commit -m "feat(coordinator-skill): the landing verdict reads the repository's own rules (landing-order wave 3e, Task 1)"
```

### Task 2: Clause 15, the route prose, the licence, the stops, and their pins

**Model routing:** `sonnet`, effort `high`. Clause 15 is the coordinator's contract, and the prose decides what it does with each line.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md`: clause 15 (the line starting `15. This session never calls`), step 6's pointer (the line `     "Landing on a native-queue project").` directly after `     closes (clause 15; \`references/wave-lifecycle.md\` §5,`), and step 7's pointer (the line `   \`references/wave-lifecycle.md\` §5, "Landing on a native-queue project").` directly after `7. **Final merge:** …` and its second line).
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`: §5 step 3's "One PR per child" sentence (`grep -n -- '--squash --match-head-commit' …`); "Landing on a native-queue project"'s opening parenthesis and its enqueue gate; §5b's prose, directly after the block's closing fence.
- Modify: `README.md`: the "Landing order (landing-order wave 1)" paragraph's paraphrase of clause 15, found by its content, `grep -n "never writes a$" README.md` and the line after it, which starts `repository's rulesets, branch protection, auto-merge setting or`. No numeric citation of it goes anywhere.
- Test: `server/test/coordinator-skill.test.ts`.

**Interfaces:**
- Consumes: Task 1's block, its `say "…"` and `stop "<reason>:` literals, its `route=` assignments, and its `BOUND_S`/`POLL_S` defaults, all read by the new describe from the text.
- Produces: the five landing spellings the census requires: `gh pr merge <n> --match-head-commit <handoffCommit>` and `gh pr merge <pr> --match-head-commit <handoffCommit>` (route Q, unchanged), `gh pr merge <n> --<method> --match-head-commit <handoffCommit>` (clause 15), `gh pr merge <pr> --<method> --match-head-commit <handoffCommit>` and `gh pr merge <pr> --merge --match-head-commit <handoffCommit>` (§5b), and one licensed spelling, `gh pr merge <pr> --<method> --admin --match-head-commit <handoffCommit>`, inside **The approval licence.** paragraph alone.

- [ ] **Step 1: Write the failing tests**

(a) In `CONTRACT`, after the existing comment `// Landing-order wave 1 (spec 2026-09-23 §5.1). Written with no apostrophe at` / `// all, so neither the straight nor the curly spelling can drift.`, replace the clause 15 string with these lines (a two-line comment, then the string):

```ts
  // Landing-order wave 3e (spec §5.7) rewrote its landing sentence: the route comes from the rules of the repository,
  // route Q keeps its spelling and words, a direct route spells exactly one method flag, and --admin is licensed only.
  'This session never calls `update-branch` by any route, and never writes the rulesets, branch protection, merge-method settings, auto-merge setting or `allow_update_branch` of any repository. It sends a rebase-check or any other conflict-sync request only on a conflict it has measured; beyond that, the only absorb it asks for is a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded, and it never merges main into any workspace but its own. It commits programme-ledger documents on its own ledger PR, never inside a feature PR. It lands a PR only by the route the rules of its repository give, read fresh before each landing, and every conflict among them is a stop for the operator. On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it; on a direct route it lands with `gh pr merge <n> --<method> --match-head-commit <handoffCommit>`, exactly one method flag from the method set, with `--admin` only under the approval licence and never as a fallback, and a refused merge is a stop, never retried. It closes that run only once the PR reads MERGED at `handoffCommit`: until then the run waits at `merging`.',
```

(b) Replace the whole case `it('binds the exact SHA in every \`gh pr merge\` it spells — and the native-queue spelling carries no --squash and no --admin (landing-order wave 2)', …)` with:

```ts
  it('binds the exact SHA in every `gh pr merge` it spells, with at most one method flag, and --admin only in the licence (landing-order waves 2 and 3e)', () => {
    // DERIVED: every backtick code span in the whole corpus that runs
    // `gh pr merge`. #178 put `--match-head-commit <handoffCommit>` into the
    // coordinator's merge "for exactly this reason" — the exact-SHA merge proof
    // — and a spelling that drops it merges whatever head the PR has by then.
    // `--disable-auto` DISARMS an armed auto-merge: it merges nothing, so it
    // binds no SHA. Only that exact spelling is exempt — a disarm span that
    // carries any other flag is held to the binding like every merge.
    const DISARM = /^gh pr merge <(?:n|pr)> --disable-auto$/;
    const spans = [...allSkillText.matchAll(/`([^`\n]*\bgh pr merge\b[^`\n]*)`/g)].map((m) => m[1]!)
      .filter((s) => !DISARM.test(s));
    expect(spans.length, 'fewer gh pr merge spellings than the five this corpus carries (clause 15 twice, the queue landing, the direct landing, merge commits only) — a landing spelling was dropped, or this pin went blind').toBeGreaterThanOrEqual(5);
    for (const s of spans) {
      expect(s, `\`${s}\` merges without binding the exact SHA`).toContain('--match-head-commit <handoffCommit>');
      // Route Q spells no method flag; routes G and U spell exactly one (spec §5.7.4).
      const flags = s.match(/--(?:squash|merge|rebase|<method>)(?=\s|$)/g) ?? [];
      expect(flags.length, `\`${s}\` spells more than one method flag`).toBeLessThanOrEqual(1);
      expect(s, `\`${s}\` lands with --auto, which arms rather than lands`).not.toContain('--auto');
    }
    // Route Q, word for word as wave 2 left it: clause 15's and the queue landing's.
    expect(spans).toContain('gh pr merge <n> --match-head-commit <handoffCommit>');
    expect(spans).toContain('gh pr merge <pr> --match-head-commit <handoffCommit>');
    // Routes G and U, and a merge-commits-only repository's exact spelling (spec §5.7.4, §12).
    expect(spans).toContain('gh pr merge <n> --<method> --match-head-commit <handoffCommit>');
    expect(spans).toContain('gh pr merge <pr> --<method> --match-head-commit <handoffCommit>');
    expect(spans).toContain('gh pr merge <pr> --merge --match-head-commit <handoffCommit>');
    // #178's fixed squash is gone: a squash is whatever the method set gives, never a spelling of its own.
    expect(spans.filter((s) => s.includes('--squash')), 'a gh pr merge spelling fixes --squash').toEqual([]);
    // `--admin` is spelled once, as the approval licence's direct spelling, inside the licence paragraph alone.
    expect(spans.filter((s) => s.includes('--admin')), 'a gh pr merge spelling carries --admin outside the licence')
      .toEqual(['gh pr merge <pr> --<method> --admin --match-head-commit <handoffCommit>']);
    const wl = refs('wave-lifecycle.md');
    const lic = wl.indexOf('**The approval licence.**');
    expect(lic, 'wave-lifecycle.md lost the approval licence paragraph').toBeGreaterThanOrEqual(0);
    const at = wl.indexOf('`gh pr merge <pr> --<method> --admin --match-head-commit <handoffCommit>`');
    expect(at, 'the licensed spelling is not inside the approval licence paragraph').toBeGreaterThan(lic);
    expect(at).toBeLessThan(wl.indexOf('\n\n', lic));
  });
```

(c) In `'lands before it closes on a native-queue project — the last wave too — …'`, replace

```ts
    // changes when the operator turns the queue on or rolls it back.
    expect(para).toContain('.type == "merge_queue"');
```

with

```ts
    // changes when the operator turns the queue on or rolls it back. Since wave
    // 3e the measure is the landing verdict, on the PR's own base (spec §5.7.6).
    expect(para).toContain('the landing verdict (§5b) answers `ROUTE Q`');
    expect(para, 'the queue test reads the literal main again').not.toContain('rules/branches/main');
    // The discovered required set gates the enqueue too, not only --required.
    expect(para).toContain('every required name the verdict discovered passes on the head');
```

(d) At the end of the file, add:

````ts
// Landing-order wave 3e (spec 2026-09-23 §5.7): the route comes from the repository's own rules. The verdict block
// itself is RUN by `coordinator-landing-verdict.test.ts`; this describe holds the prose that acts on each line it
// prints, derived from the block wherever the block is the source, so a line the block learns to print and the prose
// never handles is a red here.
describe('the landing route from the repository\'s own rules (landing-order wave 3e, spec §5.7)', () => {
  const wl = refs('wave-lifecycle.md');
  const at = wl.indexOf('### 5b — The landing route, from the repository\'s own rules');
  const sec = at >= 0 ? wl.slice(at, wl.indexOf('\n## ', at)) : '';
  const fence = /```bash\n([\s\S]*?)```/;
  const block = fence.exec(sec)?.[1] ?? '';
  const prose = flat(sec.replace(fence, ''));

  it('§5b carries the verdict block and prose around it', () => {
    expect(at, 'wave-lifecycle.md lost §5b').toBeGreaterThanOrEqual(0);
    expect(block).toContain('# The landing verdict');
    expect(prose.length, '§5b says nothing about what to do with the verdict').toBeGreaterThan(2000);
  });

  it('acts on every line the block can print', () => {
    const words = [...new Set([...block.matchAll(/say "([A-Z]+(?: [a-z-]+(?=:))?)/g)].map((m) => m[1]!))];
    const routes = [...new Set([...block.matchAll(/\broute=([A-Z])\b/g)].map((m) => m[1]!))].sort();
    expect(routes).toEqual(['G', 'Q', 'U']);
    expect(words.sort()).toEqual(['MERGED', 'RED', 'ROUTE', 'STOP', 'WAIT not-reported', 'WAIT pending']);
    for (const w of words.filter((x) => x !== 'ROUTE')) expect(prose, `§5b never says what \`${w}\` means`).toContain('`' + w);
    for (const r of routes) expect(prose, `§5b never says what \`ROUTE ${r}\` means`).toContain('`ROUTE ' + r);
    // The licence and strictness words: the block's own literals, and the prose's handling of each.
    for (const [a, src] of [['admin=licensed', 'admin=licensed'], ['admin=never', 'admin=never'],
      ['strict=yes', '"yes"'], ['strict=unknown', '"unknown"']] as const) {
      expect(block, `the block never prints ${a}`).toContain(src);
      expect(prose, `§5b never says what \`${a}\` means`).toContain('`' + a + '`');
    }
  });

  it('lists exactly the stops the block prints, and the two no read decides', () => {
    const printed = [...new Set([...block.matchAll(/stop "([a-z0-9-]+):/g)].map((m) => m[1]!))].sort();
    const lead = 'The verdict stops with one of these reasons: ';
    const i = prose.indexOf(lead);
    expect(i, '§5b no longer lists the verdict\'s stops').toBeGreaterThanOrEqual(0);
    const listed = [...prose.slice(i + lead.length, prose.indexOf('.', i)).matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!).sort();
    expect(listed).toEqual(printed);
    expect(printed).toEqual(['auto-merge-off', 'licence-fails', 'method-set-empty', 'not-at-head', 'not-reported',
      'queue-method-not-allowed', 'read-3b-unknowable', 'rebase-only', 'two-queue-methods', 'unknown-rule-type',
      'unreadable', 'unverifiable']);
    expect(prose).toContain('Three stops no read decides are yours to name: `red-unreachable`');
    expect(prose).toContain('`verdict-unread` (above) and `github-refused`');
    expect(prose).toContain('is the stop `verdict-unread`: say what the run printed');
  });

  it('says what a stop does, and what is not one (spec §5.7.5)', () => {
    expect(prose).toContain('A stop leaves the run where it is (at `merging` or `awaiting-review`), enqueues nothing, merges nothing and changes nothing.');
    expect(prose).toContain('which stop fired and what it read');
    expect(prose).toContain('never to another route');
    expect(prose).toContain('Not a stop: a required check red on the head that is the PR\'s own');
  });

  it('fixes one bounded foreground wait for a required name that has not reported, and states its bound (spec §5.7.3)', () => {
    const poll = /POLL_S=\$\{POLL_S:-(\d+)\}/.exec(block)?.[1];
    expect(poll, 'the block lost its poll interval default').toBeTruthy();
    expect(block, 'the block waits by default; only BOUND_S may start the wait').toContain('BOUND_S=${BOUND_S:-0}');
    expect(prose).toContain('`gh pr checks <pr> --required --watch`');
    expect(prose).toContain(`\`gh pr checks <pr> --watch --interval ${poll}\``);
    // The every-check watch runs ONCE: a non-required check that never completes must not hold the wait open.
    expect(prose).toContain('once, as one Bash call with its timeout at 600000, never repeated');
    expect(prose).toContain('`BOUND_S=300`');
    expect(prose).toContain(`every ${poll} seconds for at most 300 seconds`);
    expect(prose).toContain('The bound is five minutes after the last of the PR\'s reported checks finished.');
    expect(prose).toContain('fifteen minutes in all at most');
    expect(prose).toContain('never by ending your turn');
  });

  it('licenses --admin narrowly, never as a fallback, and never retries a refused merge (spec §5.7.4)', () => {
    expect(prose).toContain('`--admin` is licensed on a direct route only');
    expect(prose).toContain('Without a missing approval `--admin` is never passed; under read 3b it is never used');
    expect(prose).toContain('a fallback is `--admin` after a refusal, and this licence is decided before the merge, from reads');
    expect(prose).toContain('never retried with another method, with `--admin` or with `--auto`');
    expect(prose).toContain('This session writes no setting to make a route work');
    // Today's sentence, read literally, passed --admin over a required check an admin may skip: withdrawn.
    expect(allSkillText).not.toContain('where the repository\'s ruleset requires it');
  });

  it('keeps route Q word for word in clause 15 and adds the merge-method settings to what it never writes (spec §5.7.6)', () => {
    expect(CONTRACT[14]).toContain('On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it');
    expect(CONTRACT[14]).toContain('never writes the rulesets, branch protection, merge-method settings, auto-merge setting or `allow_update_branch`');
    expect(CONTRACT[14]).toContain('with `--admin` only under the approval licence and never as a fallback');
  });

  it('SKILL.md step 6 sends every landing to the verdict', () => {
    const start = skill.indexOf('6. **Rule on the report**');
    expect(flat(skill.slice(start, skill.indexOf('**Same project:**', start))))
      .toContain('Every producer lands by the route the landing verdict reads from the rules of its repository (`references/wave-lifecycle.md` §5b)');
  });

  it('SKILL.md step 7 sends the last wave\'s landing to the verdict', () => {
    const seven = skill.indexOf('7. **Final merge:**');
    expect(seven, 'SKILL.md lost step 7').toBeGreaterThanOrEqual(0);
    expect(flat(skill.slice(seven, skill.indexOf('\n## ', seven))))
      .toContain('The last wave\'s producer lands by the route the landing verdict reads (`references/wave-lifecycle.md` §5b).');
  });
});
````

- [ ] **Step 2: Run them and record the red**

Run: `(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts)`

Expected on Task 1's text: `Tests  11 failed | 167 passed (178)` (169 before the new describe), predicted, not measured. The prototype measured `10 failed | 167 passed (177)` (the final tests against Task 1's commit); this plan adds the step 7 case, which fails on Task 1's text too:
- `carries all seventeen clauses verbatim` (the new `CONTRACT[14]`);
- the census, renamed `binds the exact SHA in every \`gh pr merge\` it spells, with at most one method flag, and --admin only in the licence (landing-order waves 2 and 3e)`;
- `lands before it closes on a native-queue project — …`;
- eight of the new describe's nine: all but `keeps route Q word for word in clause 15 …`, which reads the test's own `CONTRACT` and passes on any skill text (it pins the array, and `carries all seventeen clauses verbatim` pins the skill to the array).

- [ ] **Step 3: Implement**

(a) In `ccd/coordinator-skill/SKILL.md`, replace the whole line of clause 15 with:

```markdown
15. This session never calls `update-branch` by any route, and never writes the rulesets, branch protection, merge-method settings, auto-merge setting or `allow_update_branch` of any repository. It sends a rebase-check or any other conflict-sync request only on a conflict it has measured; beyond that, the only absorb it asks for is a land-sync to the PR it named next to land in a strict-protection repository, or an ejection naming the base sha the landing line recorded, and it never merges main into any workspace but its own. It commits programme-ledger documents on its own ledger PR, never inside a feature PR. It lands a PR only by the route the rules of its repository give, read fresh before each landing, and every conflict among them is a stop for the operator. On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it; on a direct route it lands with `gh pr merge <n> --<method> --match-head-commit <handoffCommit>`, exactly one method flag from the method set, with `--admin` only under the approval licence and never as a fallback, and a refused merge is a stop, never retried. It closes that run only once the PR reads MERGED at `handoffCommit`: until then the run waits at `merging`.
```

The route Q sentence is word for word through "which enqueues it"; the closing sentence changes only from ", and it closes" to "It closes". `update-branch` still appears once.

(b) In SKILL.md step 6, replace

```markdown
     closes (clause 15; `references/wave-lifecycle.md` §5,
     "Landing on a native-queue project").
```

with

```markdown
     closes (clause 15; `references/wave-lifecycle.md` §5,
     "Landing on a native-queue project"). Every producer lands by the route
     the landing verdict reads from the rules of its repository
     (`references/wave-lifecycle.md` §5b), on every project, before each
     landing.
```

(b2) In SKILL.md step 7, replace

```markdown
   before this close, as every producer does (clause 15;
   `references/wave-lifecycle.md` §5, "Landing on a native-queue project").
```

with

```markdown
   before this close, as every producer does (clause 15;
   `references/wave-lifecycle.md` §5, "Landing on a native-queue project").
   The last wave's producer lands by the route the landing verdict reads
   (`references/wave-lifecycle.md` §5b).
```

No measured pin forbids it: the step 7 pins are `toContain` reads an appended sentence cannot break (`step 7 says a child is queued for server reclaim …` and the native-queue case's "the last wave's producer LANDS before this close"), and the slices that end at step 7 (`'\n7. **Final merge:**'`) start before it.

(c) In `wave-lifecycle.md` §5 step 3's "One PR per child", replace

```markdown
   MERGED with `headRefOid` equal to it — the coordinator merges with
   `gh pr merge <pr> --squash --match-head-commit <handoffCommit>` (plus
   `--admin` where the repository's ruleset requires it) for exactly this
   reason — and on a native-queue project it lands with the same binding, as
```

with

```markdown
   MERGED with `headRefOid` equal to it — the coordinator lands every PR with
   `--match-head-commit <handoffCommit>`, by the route §5b reads from the
   repository's own rules, for exactly this reason — and on a native-queue
   project it lands with the same binding, as
```

(d) In "Landing on a native-queue project", replace the opening

```markdown
   **Landing on a native-queue project** (one whose `main` requires GitHub's
   merge queue — measure it before each landing, never from memory: from a
   checkout of its repository,
   `gh api 'repos/{owner}/{repo}/rules/branches/main' --jq 'any(.[]; .type == "merge_queue")'`
   answers `true`): the producer LANDS BEFORE IT CLOSES. Once its review is
```

with

```markdown
   **Landing on a native-queue project** (one whose base branch requires
   GitHub's merge queue — measure it before each landing, never from memory:
   the landing verdict (§5b) answers `ROUTE Q`, reading the PR's own base,
   never the literal `main`): the producer LANDS BEFORE IT CLOSES. Once its review is
```

and its enqueue gate

```markdown
   `awaiting-review`, re-measured). Enqueue only a PR whose required checks
   have all passed — `gh pr checks <pr> --required` exits 0 (8 is pending, 1
   is failed): for any other PR gh arms auto-merge instead of queueing it,
```

with

```markdown
   `awaiting-review`, re-measured). Enqueue only a PR whose required checks
   have all passed — every required name the verdict discovered passes on the
   head, and `gh pr checks <pr> --required` exits 0 (8 is pending, 1
   is failed only when the verdict reads a required name red): for any other
   PR gh arms auto-merge instead of queueing it,
```

Everything else in that paragraph stays word for word (§5.7.6): no `--squash`, no `--admin`, the read-back and the disarm.

(e) Directly after the block's closing fence in §5b, leave one blank line and add exactly:

```markdown
Run it once the review is clean and the run is at `merging` (§4), in the
order step 3 gives for route Q, and again after every wait. Its first word
decides what this session does, and nothing else does:

- `ROUTE Q method=<m> admin=never` — the native queue, merging by `<m>`: land
  as "Landing on a native-queue project" (step 3) says, with no method flag
  and never `--admin`, the read-back and the disarm rule included.
- `ROUTE G method=<m> admin=<a>` — a gated direct merge: every required check
  has passed on the head. Merge from your own session with exactly
  `gh pr merge <pr> --<method> --match-head-commit <handoffCommit>`, `<method>`
  being the line's `<m>`; on a merge-commits-only repository that is exactly
  `gh pr merge <pr> --merge --match-head-commit <handoffCommit>`.
- `ROUTE U method=<m> admin=<a>` — an ungated direct merge: nothing is
  required and nothing waits. The same spelling as route G.
- `admin=never` — no `--admin`. `admin=licensed`, on a direct route only — the
  approval licence holds (below), and the spelling gains `--admin`.
- `strict=yes` — a strict-protection repository: clause 15's land-sync applies
  as it does today. `strict=no` — it does not. `strict=unknown` comes only under
  read 3b: on a direct route the verdict has already stopped on a head behind
  the base, and route Q needs no strictness, since the queue tests the merged
  group itself.
- `MERGED head=<sha>` — the PR already landed: prove it as step 3 does
  (MERGED, `headRefOid` equal to `handoffCommit`). It is not a stop; a
  different head fails the proof, and that is reported, never closed on.
- `WAIT pending: <names>` — a reported required check is still running. Wait
  in the foreground, `gh pr checks <pr> --required --watch`, again if the call
  times out while a reported required check is still pending, then run the
  verdict again — never by ending your turn: no mail comes when checks finish.
- `WAIT not-reported: <names>` — a required name nothing has reported on the
  head yet, whatever `gh pr checks <pr> --required` exits: it judges only the
  checks that have reported, and its `--watch` returns at once when every
  reported one is green. Wait on every check instead,
  `gh pr checks <pr> --watch --interval 30`, once, as one Bash call with its
  timeout at 600000, never repeated, whatever it exits or however it ends: a
  check that is not required and never completes must not hold the wait open.
  Then run the verdict again with `BOUND_S=300` on the line before it, and the
  Bash tool's timeout at 600000. It reads read 5 again every 30 seconds for at
  most 300 seconds.
  **The bound is five minutes after the last of the PR's reported checks finished.**
  If the watch was cut off at its timeout, the five minutes start there instead:
  fifteen minutes in all at most.
  A name it still reads as not reported is the stop `not-reported`.
- `RED <names>` — a required check is red on the head, each name with its
  kind. If it is the PR's own, that is the existing fix-round rule (step 3:
  on route Q disarm first, then a fix round to the owning worker on the
  `merging → working` edge). If it is not the PR's own and its kind is
  `[github-actions]`, one `gh run rerun <run id> --failed` and the same wait,
  then the verdict again. One of kind `[app <id>]` or `[status]` that is not
  the PR's own, which no rerun here reaches, or one still red after the one
  rerun, is the stop `red-unreachable`.
- `STOP <reason>: <what it read>` — a stop (below).
- Anything else — no line at all (the run was cut off or did not parse), more
  than one line, or a first word this list does not name — is the stop
  `verdict-unread`: say what the run printed, and never land, enqueue or choose
  a route by hand.

**The approval licence.** `--admin` is licensed on a direct route only, and
only when all three hold, each read fresh for this landing: an approval the
fleet cannot give is required and missing (a `pull_request` rule's, or classic
protection's, `required_approving_review_count` above 0, and `reviewDecision`
not `APPROVED`); every required check has passed on the head; and `--admin`
cannot skip a gate — no other gate applies, no review conversation must be
resolved that an admin could skip (a `pull_request` rule's
`required_review_thread_resolution`, or classic
`required_conversation_resolution` without `enforce_admins`), classic required
checks carry `enforce_admins`, and every ruleset carrying required checks
answers `current_user_can_bypass: never`, an unreadable answer, or a rule that
names no ruleset, counting as able to bypass. The verdict weighs all three: it answers `admin=licensed`, and only
then the spelling is
`gh pr merge <pr> --<method> --admin --match-head-commit <handoffCommit>`, or it stops `licence-fails`.

Without a missing approval `--admin` is never passed; under read 3b it is
never used; and it is never a fallback: a fallback is `--admin` after a
refusal, and this licence is decided before the merge, from reads. An approval
kept in classic protection with `enforce_admins` on binds an admin too, so
`--admin` does not help there, and GitHub's refusal is the stop.

**On every route** the merge is proven as step 3 proves it: MERGED, with
`headRefOid` equal to `handoffCommit`. A refused merge on route G or U is
read, reported and stopped on, and never retried with another method, with
`--admin` or with `--auto`. This session writes no setting to make a route
work: no ruleset, no branch protection, no merge-method or auto-merge setting
(clause 15).

**A stop.** A stop leaves the run where it is (at `merging` or
`awaiting-review`), enqueues nothing, merges nothing and changes nothing. Say
in your turn's text which stop fired and what it read, for the operator:
every stop goes to the operator, never to another route. The verdict stops with one of these reasons: `unreadable`, `read-3b-unknowable`, `not-at-head`,
`unknown-rule-type`, `method-set-empty`, `rebase-only`,
`queue-method-not-allowed`, `two-queue-methods`, `auto-merge-off`,
`unverifiable`, `not-reported`, `licence-fails`. Three stops no read decides are
yours to name: `red-unreachable` (above), `verdict-unread` (above) and `github-refused`, a merge GitHub
refused for a rule it enforces at merge and this session does not verify —
reviews, signatures, deployments, code scanning, required workflows — which
this session never works around. Not a stop: a required check red on the head
that is the PR's own; that goes to the fix-round rule, on route G exactly as
on route Q.
```

(f) In `README.md`'s "Landing order (landing-order wave 1)" paragraph, the paraphrase of clause 15 (the sentence starting `Coordinator clause 15 is the other half:`), replace the line

```markdown
repository's rulesets, branch protection, auto-merge setting or `allow_update_branch`, sends a
```

with

```markdown
repository's rulesets, branch protection, merge-method settings, auto-merge setting or `allow_update_branch`, sends a
```

One phrase, nothing else in README moves (the coordinator's ruling 7). Nothing pins that sentence, so it carries no mutation; Step 4 checks it by hand.

- [ ] **Step 4: Run the tests**

```bash
(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/coordinator-landing-verdict.test.ts)
(cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts)
```

Expected: `coordinator-skill` 178 passed (178) and `coordinator-landing-verdict` 67, predicted, not measured (the prototype measured 177 and 63). Measured on the prototype: `worker-skill` 55; `reviewer-skill` 17; `citations` 4; `single-definition` 836; `ccrc-api-closed` 12. Then check by hand that no count word moved, `update-branch` is still once, and README carries the phrase once:

```bash
grep -c 'These seventeen sentences' ccd/coordinator-skill/SKILL.md          # expected 1
grep -o -r 'update-branch' ccd/coordinator-skill | wc -l                 # expected 1
grep -c "branch protection, merge-method settings, auto-merge setting or" README.md   # expected 1
```

- [ ] **Step 5: Mutations, then commit**

Each is run against the file named, then restored byte for byte (`cmp`). Every count in this table is the prototype's, on its 177-test `coordinator-skill.test.ts` and its 61-test verdict file; T16 and T17 are this plan's own, and their counts are predicted, not measured. None is an expected value: the worker re-measures EVERY mutation on the final files (178 and 67 tests, so each passed count is predicted one higher on `coordinator-skill` and four higher on the verdict file) and reports each measured count beside the prototype's in the wave-done, naming every one that differs.

| # | Edit | Test | Prototype's count |
|---|---|---|---|
| T1 | clause 15 drops "or `--admin`" from route Q's "never with `--squash` or `--admin`" | coordinator-skill | 1 failed \| 176: `carries all seventeen clauses verbatim` |
| T2 | clause 15 drops "merge-method settings, " | coordinator-skill | 1 \| 176: the same |
| T3 | §5b's route G spelling gains `--admin` (`gh pr merge <pr> --<method> --admin --match-head-commit <handoffCommit>` in the `ROUTE G` bullet) | coordinator-skill | 1 \| 176: the census |
| T4 | the merge-only spelling gains a second flag (`--merge --squash`) | coordinator-skill | 1 \| 176: the census |
| T5 | step 3's "(plus `--admin` where the repository's ruleset requires it)" restored | coordinator-skill | 1 \| 176: `licenses --admin narrowly …` |
| T6 | §5b's route G spelling drops `--match-head-commit <handoffCommit>` | coordinator-skill | 1 \| 176: the census |
| T7 | `unverifiable` dropped from "The verdict stops with one of these reasons:" | coordinator-skill | 1 \| 176: `lists exactly the stops …` |
| T8 | the block renames `rebase-only` to `rebase-alone` (both its `stop` and nothing else) | coordinator-skill | 1 \| 176: `lists exactly the stops …` |
| T8v | the same edit | coordinator-landing-verdict | 1 \| 60: `rebase is the only method …` |
| T9 | the native-queue paragraph measures `rules/branches/main` again | coordinator-skill | 1 \| 176: the native-queue case |
| T10 | the block's `POLL_S=${POLL_S:-30}` becomes `:-20` | coordinator-skill | 1 \| 176: `fixes one bounded foreground wait …` |
| T10v | the same edit | coordinator-landing-verdict | 0: 61 passed (the cases set `POLL_S` themselves) |
| T11 | the prose renames `` `WAIT not-reported` `` | coordinator-skill | 1 \| 176: `acts on every line the block can print` |
| T12 | step 6's pointer sentence deleted | coordinator-skill | 1 \| 176: `SKILL.md step 6 sends every landing to the verdict` |
| T13 | ", with `--admin`" dropped from the no-retry sentence | coordinator-skill | 1 \| 176: `licenses --admin narrowly …` |
| T14 | §5b's route G spelling gains `--auto` | coordinator-skill | 1 \| 176: the census |
| T15 | the block's `BOUND_S=${BOUND_S:-0}` becomes `:-300` | coordinator-skill | 1 \| 176: `fixes one bounded foreground wait …` |
| T16 | the `WAIT not-reported` bullet's "once, as one Bash call with its timeout at 600000, never repeated" becomes "again if the call times out while a check is still pending" | coordinator-skill | 1 \| 177, predicted, not measured: `fixes one bounded foreground wait …` |
| T17 | step 7's pointer sentence deleted | coordinator-skill | 1 \| 177, predicted, not measured: `SKILL.md step 7 sends the last wave's landing to the verdict` |
| T18 | §5b's `verdict-unread` bullet deleted | coordinator-skill | 1 \| 177, predicted, not measured: `lists exactly the stops …` |

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md README.md server/test/coordinator-skill.test.ts
git commit -m "feat(coordinator-skill): clause 15 lands by the route the rules give; route G and U spellings and the approval licence (landing-order wave 3e, Task 2)"
```

### Task 3: The wave's gate, the PR, the wave-done, the deploy and the live proof

**Model routing:** `sonnet`, effort `medium`.

- [ ] **Step 1: The whole wave's owning gates, one file at a time, in the foreground**

- Server, the skill and its pins: `coordinator-skill`, `coordinator-landing-verdict`, `worker-skill`, `reviewer-skill`, `install-coordinator-skill`, `wrapper-roster-fixture`, `routing-references`, `dead-coordinator-prose`, `crossrepo-prose`, `expiry-lane-prose`.
- Server, the landing text the server sends and the hook that guards it: `landing-verdict`, `pr-queue-lane`, `update-branch-absent`, `session-hook-merge-deny`, `session-hook-sync-advisory`, `ci-merge-queue`.
- Server, the surfaces this wave must not widen: `ccrc-api-closed`, `asks-routes`, `child-reclaim-refusals`, `run-routes`, `box-token-census`.
- Server, repository-wide: `citations`, `docs-parity`, `docs-policy`, `docs-grammar`, `topology-clean`, `single-definition`, `license`, `typecheck-tests`; `deviation-refs`, after `git fetch origin main`; `session-hook -t 'the compaction card'`.
- Builds: `(cd server && npm run build)`.

Expected: `coordinator-skill` 178 and `coordinator-landing-verdict` 67, predicted, not measured (the prototype measured 177 and 63). Measured on the prototype: `worker-skill` 55; `reviewer-skill` 17; `install-coordinator-skill` 24; `wrapper-roster-fixture` 17; `routing-references` 11; `dead-coordinator-prose` 25; `crossrepo-prose` 17; `expiry-lane-prose` 20; `landing-verdict` 28; `pr-queue-lane` 29; `update-branch-absent` 2; `session-hook-merge-deny` 125; `session-hook-sync-advisory` 78; `ci-merge-queue` 5; `ccrc-api-closed` 12; `asks-routes` 55; `child-reclaim-refusals` 20; `run-routes` 241; `box-token-census` 37; `citations` 4; `docs-parity` 54; `docs-policy` 624; `docs-grammar` 158; `topology-clean` 60; `single-definition` 836; `license` 25; `deviation-refs` 31; `session-hook -t 'the compaction card'` `175 passed | 534 skipped (709)`. `typecheck-tests` is expected at `12 passed (12)` with all four packages installed (Pre-flight 13). A count that differs because `main` moved since `cd622b2f6` is reported with the new count, not chased.

The known load flakes are in `CLAUDE.md`. Re-run one alone before calling it a break, and name every re-run. `coordinator-landing-verdict` makes about 68 bash runs, each under a 15 s timeout; a timeout under load is re-run alone the same way.

- [ ] **Step 2: Push, open the PR, and report**

Scan every changed file for private names before pushing (Global Constraints). Push the workspace branch and open the PR (`ccd pr-open` or `gh pr create`, as the worker skill says). The body:
- says what the wave does in the Goal's terms: the route from the repository's own rules, three routes, every conflict a stop, no server code, no `ccd` verb, no grant;
- links §5.7 and the operator's rulings by the spec's GitHub blob URL, `https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, naming §5.7 and §11 items 7 to 15, and names #1092 as the merge that carried the approved text;
- lists Pre-flight 2 (`--required` exit 0 with a required name unreported) and Pre-flight 3 (a jq failure falling through) as what the block is built to catch;
- states the bound: a required name that has not reported is waited for with ONE `gh pr checks <pr> --watch --interval 30` call, never repeated, then the verdict re-reads read 5 every 30 seconds for at most 300 seconds, fifteen minutes in all at most, and a name still unreported is the stop `not-reported`;
- names the two ruled departures, both to be reported in the wave-done (the coordinator's rulings 4 and 6): the new test file outside §6's surface row (Pre-flight 9), and the `unreadable` stop on a base outside `[A-Za-z0-9._/-]`, which §5.7.1 does not list (Pre-flight 10(d));
- names the one departure not yet ruled, the conversation-resolution licence stop (Pre-flight 10(f)), for the coordinator's ruling;
- names what it leaves (Pre-flight 11);
- says the deploy (below): only the fleet box's skill homes change; the server box carries no skill.

Check the PR's `select tests` summary lists `coordinator-skill` and `coordinator-landing-verdict`. If one is missing, say so in the wave-done, and the coordinator asks for a `workflow_dispatch` full run.

Send the wave-done with the measured fingerprint, the suite line, every mutation's re-measured red beside the prototype's count (V1–V32 as listed, T1–T17 with T8v and T10v), naming every count that differs, the departures of Pre-flight 9, 10(d) and 10(f), Step 5's two live measurements of Task 1, which task waited on which claim, and every re-run.

**Deploy (spec §11, item 14):** the operator's act, never a session's. Every merge to `main` becomes a prerelease within about a minute. The operator moves the fleet with `ccrc rollout --to <that prerelease's tag>` from a machine with ssh to both boxes, fleet box first (`rollout`'s default). Then the installed skill text is verified in every home: on the fleet box, `ccrc doctor`'s `skills` line must read PASS, `<n>/<n> homes carry the shipped …` (it `diff`s every rostered home's `skills/ccrc-coordinator` against the shipped tree, `references/wave-lifecycle.md` included). A `<home>: ccrc-coordinator differs` line names a home the install did not reach; its cure is `ccrc doctor --fix`, the operator's. A server-role box skips the check by design. Until doctor passes, a coordinator in a home that differs still runs the old text, and is not asked to land by the new route.

After the fleet box runs the build and doctor passes, the coordinator takes the live proof, read only up to the landing it was going to make anyway:
- on its next landing on this repository, the verdict answers `ROUTE Q method=squash admin=never strict=no` (or a `WAIT` that ends in it), as §5.7.7 predicts: the four classic checks gate the enqueue as the discovered set, and the enqueue, the read-back and the disarm are today's;
- that landing's queue merge reads `merged … landed`, never `merged … none` (wave 3d's open check (a), Task 7 (a)'s reading);
- any other line on this repository is a stop and goes to the operator with the line: either the repository's rules changed, or the verdict is wrong.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open. **A worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail: what departed, where, and why. The coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file.
