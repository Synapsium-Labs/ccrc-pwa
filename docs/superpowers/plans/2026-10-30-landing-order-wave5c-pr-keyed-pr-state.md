# Landing order, wave 5c — the PR-keyed `pr-state` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ccd pr-state --project <p> --pr <n>` answers one PR's landed state with no workspace binding (spec §5.5, "Landed state is PR-keyed"). The server holds its words, a reader of its line and a capability-gated brand, ready for sub-wave 5h's reader.
- **Five words:** `open`, `merged`, `closed`, `unmeasured` and `absent` (D-7593).
- **The line echoes** the PR's head, base, merge commit, merge time and cross-repository flag, so a reader can bind it to a landing entry (D-7594).
- **A PR the merge queue landed in a group** answers `merged` through the existing train proof, kept as the session form keeps it (D-7595). A claim the proof refused, or could not read, is `unmeasured` (D-7596).
- **Carried:** wave 3d's F1 and F6 text (D-7597), and the landing-rules read is paged (review 1109, D-7598).

**Why:**
- Spec §5.5 says a reader walks the landing entries with a PR-keyed form, separate from `sweepMerged`'s per-workspace loop, so entries with no run and hand merges are seen. Sub-wave 5h is that reader.
- The fleet box goes first (spec §9): this sub-wave ships the form, and 5h reads it only once the fleet box runs it. An older `ccd` dies on the new argv's arity, so the brand is gated by the capability, never by the bare verb.

**Architecture:**
- **Task 1** (`ccd/ccd`, `ccd/lib/train-proof.sh`): an early dispatch in `cmd_pr_state` before its arity checks, so the two existing forms answer exactly as today. One helper, and one python writer of every line (`_pr_py by-pr`); a failed gh call is named by `_gh_fail_reason`, `_gh_pr_list`'s stderr classification lifted so both use it. The train proof is entered at `_ws_train_record`, and its verdict comes from one `train_flags` judge moved out of `annotate`. A `pr-state-pr-v1` caps token, the README, and the growth waiver (D-7599).
- **Task 2** (`server/src/prstate.ts`, `server/src/ccdargv.ts`): the five words are defined once, with a pure reader of the line that keeps every distinction, and the `prStatePr` brand is gated by `capRow('pr-state-pr-v1')`. A words pin runs the real `ccd` in a fixture HOME and checks both languages agree. There is no production caller: 5h adds the call site and its `ccdCan` gate.
- **Task 3:** the carried text, and the paged rules read.
- **Task 4:** the gate, the PR and the wave-done.

**Tech Stack:** bash and python in `ccd`; TypeScript (Node ≥ 22.16) in the server; vitest with fixture HOMEs and the GH stub.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.5, "Landed state is PR-keyed";
- §5.2 and its wave 3d amendment (Task 3);
- §9, the fleet box first.

**Also:** `docs/superpowers/specs/2026-07-29-ccrc-pr-lifecycle-design.md`: "No GitHub-sourced string is ever placed in a prompt, an argv, or a shell." This form departs from it for one anchored string, the base name (D-7595 (b)).

**Other sources:** the ledger, `docs/superpowers/programs/landing-order.md`, Carried constraints: "From wave 3d's review (759), carried" (F1, F6, F7) and "From wave 3b's review (1109), carried".

**Prerequisite:** wave 5a (#1960) and this plan are on `main`.

**Plan review.**
- **Drafting.** Each task was drafted against `main` by its own Opus reader, and a Sonnet reader checked it against `main`: every code claim, every red-first step and every mutation row's red. All 18 fixes they found are applied.
- **Review.** Three Opus lenses then reviewed the whole plan (executability, spec fidelity, fail-closed), a Sonnet refuter checked the serious findings, and a reader checked the fixed plan for internal consistency. One critical finding held and is answered: Task 2's reader expected a line Task 1 never prints, so it now reads Task 1's line exactly. Each important finding is answered:
  - a PR from a fork never runs the train proof, as on the session form (D-7595);
  - a failed `gh` call keeps the words the existing classifier gives it, lifted into one helper both callers use (D-7594);
  - the GitHub-sourced base name that reaches python's and awk's argv is a named departure from the PR-lifecycle rule, anchored first (D-7595);
  - heads and merge commits are 40 hex;
  - the modules are installed before Task 1, and the growth waiver covers the whole PR (D-7599).
- **Minors.** Each minor finding is answered too, and the review's cuts removed text that decided nothing.

## What this does not claim
- **No reader of the form.** Nothing in the server calls it: 5h walks the entries with it, under a per-pass cap and backoff.
- **No `coord.db` table and no route.**
- **The form is not read-only.** With a train claim it writes the kept train proofs, as `pr-state --session` does (D-7595).
- **Not every carried item.** `deploy/measure-landing.py`'s single-page read stays carried, and so does wave 3d's F5 (`sweepPr`'s docstring).
- **No `land-candidate`.** The operator left it out of wave 5.

## Global Constraints
- **Modules first.** Before Task 1, run `npm ci` in `server/`, then in `agent/`. Every later step's `./node_modules/.bin/…` resolves from them.
- **Fixture HOMEs only** (`makeCcdHarness`, `makePrHarness`, the GH stub in `server/test/ccdPrHelpers.ts`, `ghContainedEnv()`). Never run `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Tests.** Every test and typecheck runs as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>` from its package, in the foreground, with a timeout of at least 600000 ms. `typecheck-tests` runs alone.
- **`ccd/ccd` is never committed stamped** (`# ccrc:stamp-at-install`): no restamp.
- **Growth.** `ccd/ccd` is growth-listed. Its whole growth in this PR, Task 3's included, is covered by the one waiver `server/test/growth-waivers/D-7599-pr-state-pr-form.json`. Task 1 writes it, with the delta measured then, only if `ccd/ccd`'s net delta already exceeds 40. Task 3 re-measures the whole PR's net delta and sets `maxDelta` to it, creating the file as Task 1 Step 5 spells it if Task 1 did not and the PR now exceeds 40. Task 4 reports the final figure. Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`. `ccdargv.ts` and `prstate.ts` are not growth-listed.
- **Citations.** Cite code by symbol or `@anchor`, never by file and line. Add no numeric line citation.
- **The wire is additive only.** No `FleetSession` field, and `FLEET_PROTO` is untouched.
- **Mutations.** Run them sequentially in the worktree, bounded with `timeout -k` and a measured `ulimit -u`. Restore each mutated file from a saved copy with its sha256 checked, never with `git checkout`, and keep each row's log under `.superpowers/sdd/`.
- **Neutral names only.** The repository is public (`project-a`, `demo`, `lane-a`, `o/r` fixtures).
- **Deviation numbers are issued, never chosen.** This plan defines D-7593 to D-7599, of the block D-7588 to D-7599 issued on 2026-10-30 for waves 5b and 5c. A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **`absent` is GitHub's definite answer only:** rc 1 and `Could not resolve to a PullRequest`. Every other failure is `unmeasured` with a closed reason, and the reader never folds `absent` into `unmeasured`.
2. **A train claim never prints `closed`.** Proved reads `merged`; refused reads `unmeasured` with `train-unproven`; unread reads `unmeasured` with `train-unread`.
3. **One writer of the line.** `_pr_py by-pr` writes every line, the failure lines included, and its exact bytes and key order are pinned. The `train_flags` move in `annotate` is behaviour-neutral, and the existing train, pr-landing, ws-audit and ws-reap suites are its characterization.
4. **Capability skew fails closed.** `CCD_CAN.prStatePr` is `capRow('pr-state-pr-v1')`, so a box whose `ccd` lists only the bare `pr-state` verb never receives the four-word argv.
5. **The paged rules read fails closed.** Any non-list or non-JSON page makes `rules` unmeasured and uncached, never a partial set accepted as whole.

---

### Task 1: the PR-keyed form in ccd

Scope items 1, 2, 3, 4, 7 and 8 of `scope-5c.md`, ccd side only. `ccd pr-state --project <p> --pr <n>` reads ONE pull request of the project's repository by number, with no workspace binding, under its own timeout, and prints ONE JSON line in one of five words. A PR CLOSED with the train label is never a bare `closed`: the form runs the existing train proof (`_ws_train_record`, the entry the bounded prover `cmd_pr_train_prove` uses) under `PR_STATE_TRAIN_TIMEOUT`, and the answer is judged by the same python that sets `landedInTrain` for every other reader (one `train_flags` judge, moved out of `annotate`). The server half (the five words in `prstate.ts`, the parser, `CCD_CAN`/`CCD_ARGV` rows, `verb-gate` `PROBE_ARGS`, the words pin) is Task 2; this task only adds the caps token to the test list `ccd-archive`/`ccd-verb-sets` hold equal to `cmd_caps`.

**Files:**
- Modify: `ccd/ccd`
  - `cmd_pr_state`: its signature comment, its header's gh-call budget paragraph, both usage `die` strings, and ONE early-dispatch line before `[[ $# -eq 2 ]]`.
  - `_gh_pr_list`: its stderr `case` moves, arms and comments unchanged, into a new helper `_gh_fail_reason` directly above it, and `_gh_pr_list` prints `{"phase":"unknown","reason":"<word>"}` from that helper's word (a move: its bytes on every path are unchanged); the header sentence "one `case` decides what a failure IS" names `_gh_fail_reason`.
  - `_pr_py`'s python: a new `def train_flags(r)` and `def train_cand(r)` after `label_names`; `annotate` and mode `train-cands` call them (a move, no behaviour change); two new modes `by-pr-cand` and `by-pr` after `train-cands`.
  - New, directly after `_pr_queue_py` (beside `_gh_pr_queue`, the survey's placement): the constants `PR_GH_VIEW_TIMEOUT=6` and `PR_VIEW_FIELDS=…`, and the helper `_pr_state_by_pr`.
  - `cmd_caps`: one line `echo pr-state-pr-v1`, directly after the `echo pr-landing-v1` line.
  - NO `_reg_get` anywhere in the new code (`ccd-reg-get-census` counts them).
- Modify: `ccd/lib/train-proof.sh` — comments only, no function body changes:
  - one row in the budget table under `# @ccd-lib:trainrecord` (`pr-state --pr`);
  - the table's lead sentence, "The proof is computed in ONE place (`_pr_train_proofs` -> `_ws_train_record`) and every reader takes its answer," becomes "The proof is made by `_ws_train_record`, entered through `_pr_train_proofs` for a workspace's rows and directly by `pr-train-prove` and `pr-state --pr`; the verdict is `_pr_py`'s one `train_flags` judge," (the clause after it, "so the budgets are the only per-verb difference:", stays);
  - `_pr_train_proofs`'s header's first sentence, "THE ONE PLACE `landedInTrain` IS DECIDED (D-7362).", becomes "THE ONE PLACE a workspace's train candidates are proved (D-7362); `pr-state --pr` proves its one PR through `_ws_train_record` directly (D-7595)."
- Modify: `ccd/contexts.tsv` — one row `_pr_state_by_pr	C4` directly after `_pr_queue_py	C4`, and one row `_gh_fail_reason	C4` directly before `_gh_pr_list	C4`.
- Modify: `README.md` — the verb table's `pr-state` row, and one new paragraph after the train-label paragraph (the one ending "removes the member's tried line.").
- Modify: `server/test/ccdCapTokens.ts` — add `'pr-state-pr-v1'` to `CCD_CAPABILITY_TOKENS`, in sorted position (after `'pr-landing-v1'`).
- Test: `server/test/ccd-pr-state.test.ts` — one new describe at the end of the file; one new `it` in `describe('pr-state argv', …)`.
- Test: `server/test/pr-timeout-budget.test.ts` — one new describe after `describe('pr-state fits inside the bound that kills it', …)`.
- Create (only if growth-check measures > 40 net code lines on `ccd/ccd`): `server/test/growth-waivers/D-7599-pr-state-pr-form.json`, with `"d": "D-7599"` and the delta measured at this task. It covers `ccd/ccd`'s whole growth in this PR; Task 3 re-sets its `maxDelta` over the whole PR (or creates it, if the PR first passes 40 there).
- Run, unmodified: `ccd-pr-landing`, `ccd-ws-audit`, `ccd-ws-reap` (the `train_flags` move reaches them through `annotate`), `ccd-pr-open`, `ccd-pr-queue`, `ccd-workspaces` (with `ccd-pr-state`, `_gh_pr_list`'s failure cases: the characterization of the `_gh_fail_reason` move), `ccd-archive`, `ccd-verb-sets`, `ccd-contexts`, `ccd-reg-get-census`, `ccd-lib-load`, `ccd-harness-integrity`, `anchors`, `citations`, `docs-parity`, `single-definition/*`, `growth-check`.

**Interfaces:**
- Consumes (unchanged, on main): `_gh_pr_list`'s stderr classification (moved, not changed: `unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`), `_gh_repo_slug` (main path → `OWNER/NAME` or rc≠0), `_plat_timeout`, `_plat_mktemp`, `_pr_num_valid` (`ccd/lib/train-proof.sh`), `_ws_train_record main repo number headOid baseShort [keep]` (rc 0 proved with `_WS_TRAIN_NUM`/`_WS_TRAIN_MERGE`; 1 refused; 2 unread; reads `_PR_TRAIN_DEADLINE`), `_pr_py` (hands `_PR_TRAIN_PROOFS`/`_PR_TRAIN_REFUSED` to python as `PR_TRAIN_PROOFS`/`PR_TRAIN_REFUSED`, and `PR_LANDED_LABEL`), python `labelled(r)`, `TRAIN_PROOFS`, `TRAIN_REFUSED`.
- Produces:
  - **argv:** `ccd pr-state --project <p> --pr <n>`; exactly four words in that order. `<p>` matches `^[A-Za-z0-9._-]+$` else `die "bad project"`; `<n>` passes `_pr_num_valid` else `die "bad pr number"`. Both die (exit 1) before any gh call. Every other shape falls through to the existing arity check, so `--session a --project b` still exits 1.
  - **Dispatch line** (first statement of `cmd_pr_state` after its header):
    `[[ $# -eq 4 && $1 == --project && $3 == --pr ]] && { _pr_state_by_pr "$2" "$4"; return; }`
  - **Usage string** (both `die`s): `usage: ccd pr-state --session <id> | ccd pr-state --project <project> [--pr <n>]`
  - **Constants:** `PR_GH_VIEW_TIMEOUT=6` (bare integer assignment, read by `pr-timeout-budget`); `PR_VIEW_FIELDS=number,state,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,labels`.
  - **The gh call (exactly one per invocation, plus the train record's when a claim makes it run):** `_plat_timeout "$PR_GH_VIEW_TIMEOUT" gh pr view "$n" --repo "$repo" --json "$PR_VIEW_FIELDS"` — under the stub it logs `timeout 6 gh pr view 42 --repo o/r --json number,state,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,labels` then `pr view 42 --repo o/r --json …`.
  - **Exit status:** 0 on every answer, including `absent` and `unmeasured`; 1 only for argv.
  - **The line** (compact JSON, `json.dumps(…, separators=(',', ':'))`, this key order, every key always present — `_pr_py by-pr` is its ONE writer, failure lines included):
    `{"number":<n>,"state":<word>,"reason":<reason|null>,"headRefOid":<str|null>,"baseRefName":<str|null>,"isCrossRepository":<bool|null>,"mergedAt":<str|null>,"mergeCommit":<oid str|null>,"landedInTrain":<bool>,"trainUnproven":<bool>,"trainUnread":<bool>,"train":<int|null>,"trainMergeCommit":<str|null>}`
  - **state words (five):** `open | merged | closed | unmeasured | absent`.
  - **reason words (closed set; `null` for every state but `unmeasured`):** `no-remote` (`_gh_repo_slug` failed; no gh call), `timeout` (gh rc 124), `_gh_fail_reason`'s word for any other non-zero rc that is not the absent shape (`unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated` or `error`, exactly as `_gh_pr_list` names the same stderr), `unreadable` (rc 0 and the body is not one JSON object whose `number` is the int `<n>`: an int, never a bool or a float), `missing-field` (a field is missing or of the wrong shape, see the parse rules), `train-unproven` (the claim's record was read and did not prove it), `train-unread` (the claim's record could not be read inside the budget).
  - **absent:** gh rc 1 AND its stderr contains `Could not resolve to a PullRequest`. Fields null, flags false.
  - **Parse rules (`by-pr`, rc 0):** `state ∈ {OPEN, MERGED, CLOSED}`; `headRefOid` a str matching `[0-9a-f]{40}` in full (never `_pr_py`'s `OID`, which takes 7 to 40 hex); `baseRefName` a str matching `[A-Za-z0-9._/-]+` not starting with `-` (`_ws_train_keyable`'s base grammar); `isCrossRepository` a bool; `labels` a list; `mergedAt` null or an ISO `YYYY-MM-DDTHH:MM:SS[.f]Z`; `mergeCommit` null or `{oid}` with `oid` matching `[0-9a-f]{40}` in full; a `MERGED` row needs both `mergedAt` and `mergeCommit.oid`; that rule applies to GitHub state `MERGED` only, so a train-landed `CLOSED` row (`mergedAt` null, `mergeCommit` null) is allowed. Any break → `unmeasured`/`missing-field` with all fields null. Then: `MERGED` → `merged`; `OPEN` → `open`; `CLOSED` with `train_flags(r)` = landed → `merged` with `train` and `trainMergeCommit` from `TRAIN_PROOFS[(n, head)]`; unproven → `unmeasured`/`train-unproven`; unread → `unmeasured`/`train-unread`; otherwise `closed`. `mergeCommit` prints the oid string (GitHub's own; `null` for a train-landed member). The echoed fields stay on a train `unmeasured` line (GitHub did answer).
  - **python, shared:**
    ```python
    def train_flags(r):
        """(landedInTrain, trainUnproven, trainUnread) of one row: the ONE judge of a train claim (D-7362, D-7378)."""
        claim = labelled(r)
        key = (str(r.get('number')), r.get('headRefOid'))
        landed = claim and key in TRAIN_PROOFS
        unproven = claim and not landed and key in TRAIN_REFUSED
        return landed, unproven, claim and not landed and not unproven

    def train_cand(r):
        """A labelled row's (number, 40-hex head), shapes anchored, or None. Never a proof."""
        n, head = r.get('number'), r.get('headRefOid')
        if (labelled(r) and isinstance(n, int) and not isinstance(n, bool) and 0 < n < 10 ** 10
                and isinstance(head, str) and re.fullmatch(r'[0-9a-f]{40}', head)):
            return n, head
        return None
    ```
    `annotate`'s three assignments become `r['landedInTrain'], r['trainUnproven'], r['trainUnread'] = train_flags(r)`. `train-cands` becomes: `c = train_cand(r) if isinstance(r, dict) else None` and then, if `c` is set and `headRefName == branch` and `baseRefName == base_short` and `isCrossRepository is False`, it writes `'%d\t%s\n' % c` (the branch, base and `isCrossRepository` conjuncts stay in the mode; the labelled, number and head conjuncts move into `train_cand`). In `by-pr`, `train` is printed as `int(TRAIN_PROOFS[key][0])`, since the proofs hold strings and the tests expect the number 50.
  - **`by-pr-cand <n>`** (stdin = the view body): prints `<40-hex head>\t<base>` iff the body is a dict, `train_cand(r)` holds (so `number` is an int and never a bool), `r['number'] == int(n)` (argv `n` is a string), `r.get('isCrossRepository') is False` (the fork conjunct `train-cands` keeps, D-7595), and `baseRefName` matches the base grammar above; else nothing.
  - **`_pr_state_by_pr project number`** (bash, C4):
    ```bash
    _pr_state_by_pr() {   # project number -> ONE JSON line: one PR by number, no workspace (landing order wave 5c)
      local project="$1" n="$2" main repo out rc errf err="" h="" b="" trc
      [[ "$project" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad project"
      _pr_num_valid "$n" || die "bad pr number"
      main="$PROJECTS_ROOT/$project"
      repo=$(_gh_repo_slug "$main") || { _pr_py by-pr "$n" no-remote </dev/null; return 0; }
      errf=$(_plat_mktemp 2>/dev/null) || errf=""
      out=$(_plat_timeout "$PR_GH_VIEW_TIMEOUT" gh pr view "$n" --repo "$repo" --json "$PR_VIEW_FIELDS" 2>"${errf:-/dev/null}"); rc=$?
      [[ -n "$errf" ]] && { err=$(cat "$errf" 2>/dev/null); rm -f "$errf"; }
      if (( rc == 124 )); then _pr_py by-pr "$n" timeout </dev/null; return 0; fi
      if (( rc != 0 )); then
        if (( rc == 1 )) && [[ "$err" == *"Could not resolve to a PullRequest"* ]]; then _pr_py by-pr "$n" absent </dev/null
        else _pr_py by-pr "$n" "$(_gh_fail_reason "$err")" </dev/null; fi
        return 0
      fi
      local _PR_TRAIN_PROOFS="" _PR_TRAIN_REFUSED=""
      IFS=$'\t' read -r h b < <(printf '%s' "$out" | _pr_py by-pr-cand "$n")
      if [[ -n "$h" && -n "$b" ]]; then
        local _PR_TRAIN_DEADLINE=$(( SECONDS + PR_STATE_TRAIN_TIMEOUT ))
        _ws_train_record "$main" "$repo" "$n" "$h" "$b" 1 < /dev/null; trc=$?
        (( trc == 0 )) && _PR_TRAIN_PROOFS="$n $h $_WS_TRAIN_NUM $_WS_TRAIN_MERGE"
        (( trc == 1 )) && _PR_TRAIN_REFUSED="$n $h"
      fi
      printf '%s' "$out" | _pr_py by-pr "$n" ""
    }
    ```
    `by-pr <n> <verdict>`: a non-empty verdict (`absent`, `no-remote`, `timeout`, or one of `_gh_fail_reason`'s six words) prints the null line with that state (`absent`) or reason (the others) and reads no stdin; `""` parses stdin by the rules above.
  - **`_gh_fail_reason errtext`** (bash, C4; directly above `_gh_pr_list`): prints ONE word for gh's stderr, the `case` `_gh_pr_list` held, arms, order and comments unchanged: `unauthenticated` (`gh auth login`, `not logged in`, `HTTP 401`), `rate-limit` (`rate limit`, `HTTP 403`), `offline` (`dial tcp`, `no such host`, `proxyconnect`), `unavailable` (`HTTP 500`/`502`/`503`/`504`), `truncated` (`unexpected end of JSON input`, `unexpected EOF`), else `error`. `_gh_pr_list`'s failure branch becomes `printf '{"phase":"unknown","reason":"%s"}\n' "$(_gh_fail_reason "$err")"`.
  - **caps token:** `pr-state-pr-v1`.

**Header text.** `cmd_pr_state`'s signature comment becomes `# ccd pr-state --session <id> | ccd pr-state --project <project> [--pr <n>]`. Its header's first sentence becomes, verbatim:
```
  # A CONSTANT NUMBER OF gh CALLS PER REPO, never one per session — one for
  # `--session`, three for `--project` (the rows, the rollups, and the merge
  # queue read `_pr_queue_stamp` makes), and one for `--project <p> --pr <n>`
  # (`_pr_state_by_pr`'s `gh pr view`, under PR_GH_VIEW_TIMEOUT), plus, only when
  # that PR is CLOSED with the train label and has no kept proof, the train
  # record's reads inside PR_STATE_TRAIN_TIMEOUT — and no number moves when a
  # project grows a ninth workspace.
```
The rest of the paragraph is unchanged, except that "sums the three calls' timeouts" becomes "sums each form's calls' timeouts", and "Read-only apart from the three registry fields it persists so a ccrc restart degrades to honest stale." becomes "Read-only apart from the three registry fields `--session`/`--project` persist, so a ccrc restart degrades to honest stale, and the kept train proofs and tried lines a train claim's record writes (`--session` and `--pr`)." Above `_pr_state_by_pr`, a short header (comments do not count toward growth) states: the five words, that `absent` is GitHub's definite answer only, that the line is `_pr_py by-pr`'s alone, that the train proof enters at `_ws_train_record` because the form has no branch for `train-cands` to bind, and that the base it keys the proof by is GitHub's: "A GitHub-sourced base name, anchored to `_ws_train_keyable`'s grammar (no backslash, space or leading dash, so `awk -v` escape processing cannot alter it), reaches python3's and awk's argv; it never reaches gh or a shell" (the PR-lifecycle spec's "No GitHub-sourced string is ever placed in a prompt, an argv, or a shell", departed from for this one anchored string, D-7595 (b)); the PR body repeats that sentence. It also carries this line, and the PR body repeats it: "The absent test (rc 1 and `Could not resolve to a PullRequest`) is deliberately narrower than `_ws_train_record`'s (which also accepts `is not a pull request`): a train candidate that is an issue is a failed candidate, but a PR-keyed read of an issue number is not GitHub's definite word about a pull request, so it reads `unmeasured` with `_gh_fail_reason`'s word (`error` for that text)."

`ccd/lib/train-proof.sh`'s budget table gains, after the `pr-state --project` row:
```
#   pr-state --pr       PR_STATE_TRAIN_TIMEOUT, beside its one `gh pr view` (PR_GH_VIEW_TIMEOUT), keeping its proofs
```

**README.** The verb table row becomes:
`| \`pr-open --session <id> …\` · \`pr-state --session <id>\|--project <p> [--pr <n>]\` | open the workspace's PR — the one PR write; read PR state, per workspace or one PR by number |`
The new paragraph, verbatim, after the train-label paragraph:
```
**One PR by number (landing order wave 5c).** `ccd pr-state --project <p> --pr <n>` reads one
pull request of the project's repository by number, with no workspace: one `gh pr view` under its
own timeout (`PR_GH_VIEW_TIMEOUT`, 6 s) and one JSON line out. Its `state` is one of five words:
`open`, `merged`, `closed`, `absent` (GitHub answered "Could not resolve to a PullRequest") or
`unmeasured`, with a `reason`: `no-remote`, `timeout`, `unreadable`, `missing-field`,
`train-unproven`, `train-unread`, or, for any other failed gh call, the word `pr-state --session` gives
the same failure (`unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`). The line echoes `headRefOid`, `baseRefName`,
`isCrossRepository`, `mergedAt` and `mergeCommit` (the oid), so a reader can bind the answer to
the head, base and repository it expected. A PR CLOSED with the train label is never a bare
`closed`: the form runs the same train proof, inside `PR_STATE_TRAIN_TIMEOUT`, and keeps a proof it
makes. A proved one reads `merged` with `landedInTrain: true`, `train` and `trainMergeCommit`; one
whose record was read and did not prove it, or could not be read, reads `unmeasured`
(`train-unproven`, `train-unread`); a labelled PR from a fork is never proved and reads `unmeasured` (`train-unread`). The workspace form reads a claim whose record was read and did not prove it as `closed` (`train-unproven`); this form reads the same fact as `unmeasured`, so the two forms' words are not interchangeable. `ccd caps` lists `pr-state-pr-v1` for a ccd that has the form.
```

- [ ] **Step 1: The failing tests.**
  - **`server/test/ccd-pr-state.test.ts`**, in `describe('pr-state argv', …)`, a new case:
    ```ts
    it('the PR-keyed form dies on a bad number, a bad project or a wrong shape, before any gh call (landing order wave 5c)', () => {
      h.makeGhRepo('demo');
      for (const argv of ['--project demo --pr 0', '--project demo --pr abc', '--project demo --pr 12345678901',
        '--project demo --pr -1', '--project demo --pr', '--project demo --pr 42 x', '--pr 42 --project demo',
        '--project demo --session 42']) {
        expect(h.run(`${GH_STUB} cmd_pr_state ${argv}`).code, argv).toBe(1);
      }
      expect(h.run(`${GH_STUB} cmd_pr_state --project "a b" --pr 42`).stderr).toMatch(/bad project/);
      expect(h.run(`${GH_STUB} cmd_pr_state --project demo --pr 0`).stderr).toMatch(/bad pr number/);
      expect(h.ghCalls()).toEqual([]);
      expect(h.ghPoison()).toEqual([]);
    });
    ```
  - **`server/test/ccd-pr-state.test.ts`**, a new describe at the end of the file. `GH_HTTP_502`, `GH_RATE_LIMITED`, `trainComment` and `trainRow` are already imported; add nothing to the import line.
    ```ts
    describe('the PR-keyed form: pr-state --project <p> --pr <n> (landing order wave 5c)', () => {
      const HEAD = 'a'.repeat(40);
      const MERGE = 'b'.repeat(40);
      const TRAIN_MERGE = 'e'.repeat(40);
      const AT = '2026-07-20T10:00:00Z';
      const FIELDS = 'number,state,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,labels';
      const viewRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
        number: 42, state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false,
        mergedAt: null, mergeCommit: null, labels: [], ...over });
      const NULLS = { headRefOid: null, baseRefName: null, isCrossRepository: null, mergedAt: null, mergeCommit: null,
        landedInTrain: false, trainUnproven: false, trainUnread: false, train: null, trainMergeCommit: null };
      const ECHO = { headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null,
        landedInTrain: false, trainUnproven: false, trainUnread: false, train: null, trainMergeCommit: null };
      /** The line, key order included: `_pr_py by-pr` prints compact JSON in exactly this order. */
      const lineOf = (state: string, reason: string | null, rest: Record<string, unknown>): string =>
        JSON.stringify({ number: 42, state, reason, ...rest }) + '\n';
      const byPr = (env = ''): string => h.sh(`${GH_STUB} ${env} cmd_pr_state --project demo --pr 42`);
      const viewed = (): string[] => h.ghCalls().filter((c) => c.startsWith('pr view')).map((c) => c.split(' ')[2]!);
      const REG = (): string => path.join(h.home, '.cc-sessions');
      const proofsFile = (): string => {
        const f = path.join(REG(), '.train-proofs');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      };
      beforeEach(() => { h.makeGhRepo('demo'); });

      it.each([
        ['open', viewRow(), 'open', {}],
        ['merged', viewRow({ state: 'MERGED', mergedAt: AT, mergeCommit: { oid: MERGE } }), 'merged',
          { mergedAt: AT, mergeCommit: MERGE }],
        ['closed, no label', viewRow({ state: 'CLOSED' }), 'closed', {}],
        ['open, from a fork', viewRow({ isCrossRepository: true }), 'open', { isCrossRepository: true }],
      ])('%s: one gh pr view under its own timeout, one line, no workspace and nothing written', (_n, row, state, over) => {
        h.sh(`${GH_STUB} :`);
        const before = fs.readdirSync(REG()).sort();
        h.ghView(42, row);
        expect(byPr()).toBe(lineOf(state as string, null, { ...ECHO, ...(over as object) }));
        expect(h.ghCalls()).toEqual([
          `timeout ${ccdSeconds('PR_GH_VIEW_TIMEOUT')} gh pr view 42 --repo o/r --json ${FIELDS}`,
          `pr view 42 --repo o/r --json ${FIELDS}`,
        ]);
        expect(fs.readdirSync(REG()).sort()).toEqual(before);
      });

      it('absent only for GitHub\'s definite "Could not resolve to a PullRequest"', () => {
        h.ghViewFail(42);
        expect(byPr()).toBe(lineOf('absent', null, NULLS));
      });

      it.each([
        ['a timeout', () => h.ghViewFail(42, 124), 'timeout'],
        ['an HTTP 502', () => h.ghViewFail(42, 1, GH_HTTP_502), 'unavailable'],
        ['a rate limit', () => h.ghViewFail(42, 1, GH_RATE_LIMITED), 'rate-limit'],
        ['rc 1 with no stderr', () => h.ghViewFail(42, 1, ''), 'error'],
        ['a signal', () => h.ghViewFail(42, 137), 'error'],
        ['a body that is not JSON', () => fs.writeFileSync(path.join(h.home, 'gh-view-42.json'), '<html>'), 'unreadable'],
        ['an empty body', () => fs.writeFileSync(path.join(h.home, 'gh-view-42.json'), ''), 'unreadable'],
        ["another PR's object", () => h.ghView(42, viewRow({ number: 43 })), 'unreadable'],
        ['a JSON list', () => h.ghView(42, [viewRow()]), 'unreadable'],
        ['a float number', () => fs.writeFileSync(path.join(h.home, 'gh-view-42.json'),
          JSON.stringify(viewRow()).replace('"number":42', '"number":42.0')), 'unreadable'],
        ['no headRefOid', () => h.ghView(42, viewRow({ headRefOid: undefined })), 'missing-field'],
        ['a short headRefOid', () => h.ghView(42, viewRow({ headRefOid: 'abc1234' })), 'missing-field'],
        ['MERGED with a short merge commit', () => h.ghView(42, viewRow({ state: 'MERGED', mergedAt: AT, mergeCommit: { oid: 'abc1234' } })), 'missing-field'],
        ['isCrossRepository as a string', () => h.ghView(42, viewRow({ isCrossRepository: 'false' })), 'missing-field'],
        ['an unknown state', () => h.ghView(42, viewRow({ state: 'DRAFT' })), 'missing-field'],
        ['MERGED with no merge commit', () => h.ghView(42, viewRow({ state: 'MERGED', mergedAt: AT })), 'missing-field'],
        ['no labels', () => h.ghView(42, viewRow({ labels: undefined })), 'missing-field'],
        ['a base name with a space', () => h.ghView(42, viewRow({ baseRefName: 'ma in' })), 'missing-field'],
      ])('%s is unmeasured, never absent', (_n, plant, reason) => {
        (plant as () => void)();
        expect(byPr()).toBe(lineOf('unmeasured', reason as string, NULLS));
      });

      it('a project whose origin is not GitHub is unmeasured no-remote, with no gh call', () => {
        h.makeRepo('plain');
        expect(h.sh(`${GH_STUB} cmd_pr_state --project plain --pr 42`))
          .toBe(JSON.stringify({ number: 42, state: 'unmeasured', reason: 'no-remote', ...NULLS }) + '\n');
        expect(h.ghCalls()).toEqual([]);
      });

      describe('a PR closed with the train claim is never a bare closed', () => {
        const claimed = (over: Record<string, unknown> = {}): Record<string, unknown> =>
          ({ ...viewRow({ state: 'CLOSED', labels: [{ name: 'landed-in-train' }] }), ...trainComment(50), ...over });
        const CLAIM_ECHO = { ...ECHO };

        it('proved: merged, landedInTrain, the train and its merge commit; the proof is kept and reused', () => {
          h.ghView(42, claimed());
          h.ghView(50, trainRow(50, TRAIN_MERGE, [[42, HEAD]]));
          const proved = lineOf('merged', null, { ...CLAIM_ECHO, landedInTrain: true, train: 50, trainMergeCommit: TRAIN_MERGE });
          expect(byPr()).toBe(proved);
          expect(viewed()).toEqual(['42', '42', '50']);
          expect(proofsFile()).toBe(`o/r main 42 ${HEAD} 50 ${TRAIN_MERGE}\n`);
          const calls = h.ghCalls().length;
          expect(byPr()).toBe(proved);
          expect(h.ghCalls().slice(calls).filter((c) => c.startsWith('pr view')).map((c) => c.split(' ')[2])).toEqual(['42']);
        });

        it.each([
          ['the train PR is CLOSED unmerged', () => h.ghView(50, trainRow(50, TRAIN_MERGE, [[42, HEAD]],
            { state: 'CLOSED', mergedAt: null, mergeCommit: null }))],
          ['the train lists another sha', () => h.ghView(50, trainRow(50, TRAIN_MERGE, [[42, 'c'.repeat(40)]]))],
        ])('refused (%s): unmeasured train-unproven, nothing kept', (_n, plant) => {
          h.ghView(42, claimed());
          (plant as () => void)();
          h.ghSearch([]);
          expect(byPr()).toBe(lineOf('unmeasured', 'train-unproven', { ...CLAIM_ECHO, trainUnproven: true }));
          expect(proofsFile()).toBe('');
        });

        it('no train names it: unmeasured train-unproven', () => {
          h.ghView(42, claimed({ comments: [] }));
          h.ghSearch([]);
          expect(byPr()).toBe(lineOf('unmeasured', 'train-unproven', { ...CLAIM_ECHO, trainUnproven: true }));
        });

        it('a train read the budget or GitHub cuts short: unmeasured train-unread, never closed', () => {
          h.ghView(42, claimed());
          h.ghViewFail(50, 124);
          h.ghSearch([]);
          expect(byPr()).toBe(lineOf('unmeasured', 'train-unread', { ...CLAIM_ECHO, trainUnread: true }));
        });

        it('a claimed PR from a fork reads no train: unmeasured train-unread', () => {
          h.ghView(42, claimed({ isCrossRepository: true }));
          expect(byPr()).toBe(lineOf('unmeasured', 'train-unread', { ...CLAIM_ECHO, isCrossRepository: true, trainUnread: true }));
          expect(viewed()).toEqual(['42']);
          expect(proofsFile()).toBe('');
        });

        it('a claimed row whose base is not a ref name is unmeasured missing-field and no train is read', () => {
          h.ghView(42, claimed({ baseRefName: '-x' }));
          expect(byPr()).toBe(lineOf('unmeasured', 'missing-field', NULLS));
          expect(viewed()).toEqual(['42']);
        });

        it('the label turned off (CCD_LANDED_LABEL empty) is a plain closed, and no train is read', () => {
          h.ghView(42, claimed());
          expect(byPr('CCD_LANDED_LABEL=')).toBe(lineOf('closed', null, CLAIM_ECHO));
          expect(viewed()).toEqual(['42']);
        });
      });

      it('ccd caps advertises pr-state-pr-v1', () => {
        expect(h.sh('cmd_caps').split('\n')).toContain('pr-state-pr-v1');
      });
    });
    ```
    Fixture note: `42.0` cannot be written through `JSON.stringify`, so the float row writes the body raw (python's `json.loads` reads it as a float, and `42.0 == 42` would pass a bare equality). The stub answers every `gh pr view 42` (the form's view AND `_ws_train_record`'s `--json comments` read) from `gh-view-42.json`, so `claimed()` carries the row and the `comments` in one object. `ghSearch([])` is set wherever the search fallback is reached, or the stub falls back to `gh-rows.json` / an empty body and the record reads `unread` for the wrong reason. `viewRow({ headRefOid: undefined })` drops the key through `JSON.stringify`.
  - **`server/test/pr-timeout-budget.test.ts`**, a new describe after the first one:
    ```ts
    describe('pr-state --project <p> --pr <n> fits inside the bound that kills it (landing order wave 5c)', () => {
      const CALLS = ['PR_GH_VIEW_TIMEOUT', 'PR_STATE_TRAIN_TIMEOUT'] as const;
      const helper = (): string => {
        const src = ccdSource();
        const start = src.indexOf('\n_pr_state_by_pr()');
        expect(start, '_pr_state_by_pr moved').toBeGreaterThan(0);
        return src.slice(start, src.indexOf('\n}\n', start));
      };

      it('the one view call plus the train budget leave the reserve', () => {
        const secs = CALLS.map((c) => ccdSeconds(c));
        secs.forEach((s, i) => expect(s, `${CALLS[i]} read as zero`).toBeGreaterThan(0));
        const sum = secs.reduce((a, b) => a + b, 0);
        expect(sum).toBeLessThanOrEqual((verbTimeoutMs('pr-state') / 1000) * (1 - LOCAL_LOOP_RESERVE));
      });

      it('one bounded gh call, and the train deadline set once from PR_STATE_TRAIN_TIMEOUT', () => {
        const body = helper();
        expect([...body.matchAll(/_plat_timeout "\$PR_GH_VIEW_TIMEOUT" gh pr view /g)].length).toBe(1);
        expect([...body.matchAll(/_plat_timeout [^\n]* gh /g)].length, 'a gh call this pin does not count').toBe(1);
        expect(body).toContain('local _PR_TRAIN_DEADLINE=$(( SECONDS + PR_STATE_TRAIN_TIMEOUT ))');
        expect(body).toContain('_ws_train_record "$main" "$repo" "$n" "$h" "$b" 1');
      });

      it('the pr-state header names the form in its gh-call budget', () => {
        const src = ccdSource();
        const start = src.indexOf('\ncmd_pr_state()');
        const header = src.slice(start, src.indexOf('[[ $# -eq 4 && $1 == --project && $3 == --pr ]]', start));
        expect(header).toContain('and one for `--project <p> --pr <n>`');
        expect(header).toContain('PR_GH_VIEW_TIMEOUT');
      });

      it('the view call alone is under the bound', () => {
        expect(ccdSeconds('PR_GH_VIEW_TIMEOUT')).toBeLessThan(verbTimeoutMs('pr-state') / 1000);
      });
    });
    ```
    Note: the existing `--project spends no time on train records` case slices 40000 characters from `\ncmd_pr_state()` and must stay green: the helper sits beside `_gh_pr_queue`, so `cmd_pr_state` grows by the dispatch line and header lines only.
  - **`server/test/ccdCapTokens.ts`:** add `'pr-state-pr-v1'` after `'pr-landing-v1'` (with the `cmd_caps` line; together, or `ccd-archive` "advertises exactly the verbs the dispatcher implements, plus the known capability tokens" and `ccd-verb-sets` go red).
- [ ] **Step 2: Run, and see them fail.** From `server/`:
  `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-pr-state.test.ts test/pr-timeout-budget.test.ts`, then `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-archive.test.ts`, then the same with `test/ccd-verb-sets.test.ts`, one file per run.
  Expected: the new argv case reds at `expect(h.run(`${GH_STUB} cmd_pr_state --project "a b" --pr 42`).stderr).toMatch(/bad project/)`, because main prints the usage line, not `bad project`. Every case of the new describe reds, because a four-word argv dies 1 on the arity check and `h.sh` throws. The budget describe reds on 'ccd no longer defines PR_GH_VIEW_TIMEOUT' and '_pr_state_by_pr moved'. The caps case reds, and so does `ccd-archive`'s "advertises exactly the verbs the dispatcher implements, plus the known capability tokens" (the token is in the list but not in `cmd_caps`); record what `ccd-verb-sets` answers. Everything else stays green.
- [ ] **Step 3: Implement** in `ccd/ccd` exactly as the Interfaces block says: the `_gh_fail_reason` move first (run `ccd-pr-state`, `ccd-pr-open`, `ccd-pr-queue`, `ccd-workspaces` green on the move alone, unchanged: `_gh_pr_list`'s failure cases are its characterization), then the `train_flags`/`train_cand` move (run `ccd-pr-state`, `ccd-pr-landing`, `ccd-ws-audit`, `ccd-ws-reap` green on the move alone — a characterization step, its own commit is not required but its run is), then the two `_pr_py` modes, the constants and `_pr_state_by_pr` after `_pr_queue_py`, the dispatch line, the header, the usage strings, the `cmd_caps` line; then `ccd/contexts.tsv`, the `train-proof.sh` comments, and README. Keep the python's comments to one line each: heredoc lines count toward growth-check.
- [ ] **Step 4: Run, and see them pass.** Same command. Expected: all green.
- [ ] **Step 5: The suites and guards.** From `server/`, each through `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>`:
  - touched, whole: `test/ccd-pr-state.test.ts test/pr-timeout-budget.test.ts`;
  - the `annotate` readers: `test/ccd-pr-landing.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts`;
  - caps and dispatch: `test/ccd-archive.test.ts test/ccd-verb-sets.test.ts`;
  - ccd guards: `test/ccd-contexts.test.ts test/ccd-reg-get-census.test.ts test/ccd-lib-load.test.ts test/ccd-harness-integrity.test.ts test/docs-parity.test.ts`;
  - tree guards: `test/anchors.test.ts test/citations.test.ts test/single-definition` (the directory);
  - growth: `GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`, after the fetch of `origin/main` the wave brief prescribes. If `ccd/ccd`'s measured net delta exceeds 40, write `server/test/growth-waivers/D-7599-pr-state-pr-form.json` = `{"file":"ccd/ccd","maxDelta":<measured now>,"d":"D-7599","reason":"the PR-keyed pr-state form: one helper, two _pr_py modes, the shared train judge and the lifted gh failure classifier; kept inline because it extends the one PR reader and the one train judge, and a library split needs a digest-checked install of its own","added":"<date -u +%F, e.g. 2026-10-30>"}`, with the delta measured at this point. Task 3 re-measures the whole PR and re-sets `maxDelta`.
  - Do NOT restamp `ccd/ccd` (`# ccrc:stamp-at-install` stays).
- [ ] **Step 6: Mutations.** One at a time, each restored from a saved copy (sha checked), under `timeout -k` and a process cap; record each red.
- [ ] **Step 7: Commit:** `feat(ccd): pr-state --project <p> --pr <n> reads one PR by number in five words, train landings proved (landing order wave 5c)`.

**Mutation table (Task 1).**

| # | Mutation | Predicted red |
|---|---|---|
| 5C-FORM-1 | Delete the early dispatch line `[[ $# -eq 4 && $1 == --project && $3 == --pr ]] && { _pr_state_by_pr "$2" "$4"; return; }` in cmd_pr_state. | Every case of the new describe 'the PR-keyed form: pr-state --project <p> --pr <n> (landing order wave 5c)': the four-word argv hits `[[ $# -eq 2 ]]` and dies 1, so h.sh throws; the argv case reds too (--pr 0 prints the usage line, not 'bad pr number'). |
| 5C-FORM-2 | Drop `&& $3 == --pr` from the dispatch condition. | 'the PR-keyed form dies on a bad number, a bad project or a wrong shape, before any gh call': `--project demo --session 42` reaches the helper with a valid number, a gh pr view is logged, exit 0, so ghCalls() is not []. |
| 5C-FORM-3 | Delete `_pr_num_valid "$n" \|\| die "bad pr number"` in _pr_state_by_pr. | The argv case: --pr 0/abc/-1/12345678901 reach gh (calls logged, exit 0), and the /bad pr number/ stderr match fails. |
| 5C-FORM-4 | Delete the absent arm, so every non-124 failure prints `_gh_fail_reason`'s word. | 'absent only for GitHub's definite "Could not resolve to a PullRequest"': the line is unmeasured/error, not absent. |
| 5C-FORM-5 | Widen the absent arm to `(( rc == 1 ))` without the stderr match. | 'an HTTP 502', 'a rate limit' and 'rc 1 with no stderr' rows of '%s is unmeasured, never absent' read absent. |
| 5C-FORM-6 | Delete the `(( rc == 124 ))` arm. | 'a timeout is unmeasured, never absent': reason error (empty stderr) instead of timeout. |
| 5C-FORM-7 | Replace `$PR_GH_VIEW_TIMEOUT` with `$PR_GH_TIMEOUT` in the gh pr view call. | The four '%s: one gh pr view under its own timeout …' cases: the logged call is `timeout 8 gh pr view …`, not `timeout 6 …`; the budget pin 'one bounded gh call …' counts 0 view calls. |
| 5C-FORM-8 | Call `gh pr view` without `_plat_timeout "$PR_GH_VIEW_TIMEOUT"`. | The same four cases: ghCalls() lacks the `timeout …` line; the budget pin counts 0 bounded calls. |
| 5C-FORM-9 | In _pr_py mode by-pr, drop the number check (type and equality). | "another PR's object is unmeasured, never absent": it reads open with echoed fields instead of unmeasured/unreadable. |
| 5C-FORM-10 | In by-pr, accept any isCrossRepository value (drop isinstance(cross, bool)). | 'isCrossRepository as a string is unmeasured': reads open with "isCrossRepository":"false". |
| 5C-FORM-11 | In by-pr, drop the requirement that labels is a list. | 'no labels is unmeasured': reads open. |
| 5C-FORM-12 | In by-pr, let a MERGED row through without mergeCommit.oid. | 'MERGED with no merge commit is unmeasured': reads merged with mergeCommit null. |
| 5C-FORM-13 | Skip the train proof: delete the by-pr-cand read and the `_ws_train_record` block. | 'proved: merged, landedInTrain …' reads unmeasured/train-unread (train_flags marks an unproved claim unread); both 'refused (%s)' rows and 'no train names it' read train-unread, not train-unproven. |
| 5C-FORM-14 | Call `_ws_train_record … 0` (keep nothing). | 'proved …': proofsFile() is '' instead of `o/r main 42 <HEAD> 50 <TRAIN_MERGE>\n`, and the second call views ['42','42','50'] instead of ['42']. |
| 5C-FORM-15 | Set `local _PR_TRAIN_DEADLINE=$SECONDS` in the helper (no train budget). | 'proved …' reads unmeasured/train-unread (no gh call allowed, no fresh failed line); the budget pin's toContain('local _PR_TRAIN_DEADLINE=$(( SECONDS + PR_STATE_TRAIN_TIMEOUT ))') fails. |
| 5C-FORM-16 | In by-pr, answer `closed` for an unproven claim (the workspace form's reading). | Both 'refused (%s): unmeasured train-unproven, nothing kept' rows and 'no train names it' read closed. |
| 5C-FORM-17 | In train_flags, drop `claim and` from `landed`. | SURVIVES, and is recorded as such: no fixture can put a proof in `TRAIN_PROOFS` for an unlabelled row, because the proof list is filled only from `by-pr-cand`'s labelled candidates. `claim` stays as the guard that `landed` never rests on the list alone. The worker measures the survivor and reports it; no test is added to force a red. |
| 5C-FORM-18 | Break the annotate move: `trainUnproven` reads `key in TRAIN_PROOFS` instead of coming from train_flags. | Existing ccd-pr-state 'a labelled PR is NOT merged when %s: closed, train-unproven, on both sides' (reason becomes train-unread) and ccd-ws-reap's train refusal rows: shows the move is pinned by the old suites. |
| 5C-FORM-19 | Delete `echo pr-state-pr-v1` from cmd_caps. | 'ccd caps advertises pr-state-pr-v1'; ccd-archive 'advertises exactly the verbs the dispatcher implements, plus the known capability tokens' (the known set holds a token the box does not print). |
| 5C-FORM-20 | Delete the no-remote early return in _pr_state_by_pr. | 'a project whose origin is not GitHub is unmeasured no-remote, with no gh call': a gh pr view with an empty --repo is logged and the line is not no-remote. |
| 5C-FORM-21 | In `by-pr-cand`, drop the base grammar check. | 'a claimed row whose base is not a ref name is unmeasured missing-field and no train is read': the base is still rejected by `by-pr` as `missing-field`, but `viewed()` is then `['42','42', ...]` because `_ws_train_record` has run on the unanchored base. |
| 5C-FORM-22 | Remove 'and one for `--project <p> --pr <n>`' from cmd_pr_state's header. | pr-timeout-budget 'the pr-state header names the form in its gh-call budget'. |
| 5C-FORM-23 | Delete the `_pr_state_by_pr	C4` row from ccd/contexts.tsv. | `ccd-contexts` 'every function ccd/ccd defines has exactly one row, and every row names one that exists'. |
| 5C-FORM-24 | In `by-pr-cand`, drop `r.get('isCrossRepository') is False`. | 'a claimed PR from a fork reads no train: unmeasured train-unread': the train record runs, so `viewed()` is not `['42']` (and the line is not train-unread). |
| 5C-FORM-25 | In by-pr, check the number by `r.get('number') == int(n)` alone (drop the int-and-not-bool type check). | "a float number is unmeasured, never absent": `42.0 == 42`, so it reads open instead of unmeasured/unreadable. |
| 5C-FORM-26 | In by-pr, match `headRefOid` and `mergeCommit.oid` with `_pr_py`'s `OID` (7 to 40 hex) instead of 40 hex. | 'a short headRefOid' reads open and 'MERGED with a short merge commit' reads merged, instead of unmeasured/missing-field. |
| 5C-FORM-27 | In `_pr_state_by_pr`, print the fixed reason `error` instead of `$(_gh_fail_reason "$err")`. | 'an HTTP 502' (unavailable) and 'a rate limit' (rate-limit) of '%s is unmeasured, never absent' read error. |


### Task 2: the capability, the brand and the server words

Scope items 5 and 6 of the 5c ruling, on the server side. `ccd pr-state --project <p> --pr <n>` gets a refusing `CCD_CAN` row (`prStatePr`, `capRow(PR_STATE_PR_CAP)`), a validated `CCD_ARGV` builder, and a registered `ccd caps` token. Its five words go into `server/src/prstate.ts` next to the queue words (`PR_QUEUE_MAP`). They are defined once in a map, and the list is derived from the map. A pure reader of the one JSON line keeps every distinction: `absent` is never `unmeasured`, a line the reader cannot follow is `unmeasured` with `by: 'reader'`, and a line where ccd itself answered `unmeasured` carries `by: 'ccd'`. A words pin runs the real `ccd` in a fixture HOME and checks that it prints exactly the server's words.

There is no lane and no production caller, because 5h is the consumer. So `ccd-can-sites.test.ts` and `verb-gate.test.ts`'s `NEW_GENERATION` gain no row. 5h adds the call site and its `ccdCan(state, 'prStatePr')` gate. `CAP_GATED_VERBS` does not gain `pr-state`: `prStateSession` and `prStateProject` are `verbRow`s, and "every CAP_GATED_VERBS verb's CCD_CAN rows default to refuse" would go red.

**Order.** This task runs after Task 1's commit. It reads Task 1's `cmd_caps` echo and its early dispatch. The `ccdCapTokens.ts` line has to land in the same commit as the echo (Note `cap-token-list-rides-with-the-echo`, below).

**Notes.**
- Note: `cap-token-list-rides-with-the-echo` (accepted, no number). The `'pr-state-pr-v1'` line in `server/test/ccdCapTokens.ts` cannot land apart from Task 1's echo in `cmd_caps`. `ccd-archive`'s "advertises exactly the verbs the dispatcher implements, plus the known capability tokens" and `ccd-verb-sets`' "cmd_caps advertises exactly the dispatched verbs" compare the real ccd's caps output with that list. If the echo lands first, both go red (`ccd-verb-sets` reads the token as an undispatched verb); if the list line lands first, `ccd-archive` goes red. So the one line goes into Task 1's commit. This task keeps the constant `PR_STATE_PR_CAP`, the `ccd-archive` `toContain`, the `capsupported` case and the `CCD_CAN` row.
- Note: `words-pin-is-behavioural` (accepted, no number). Scope item 6 asks for a words pin "in the style of `ccd-pr-queue-words.test.ts`", which extracts the word literals from ccd's source text. Task 1's Interfaces block ("The line") is the line's contract, and this task's reader reads exactly its keys. The pin runs the real ccd in a fixture HOME on five GitHub answers (OPEN, MERGED, CLOSED, rc 124, and "Could not resolve to a PullRequest"), checks that each printed state is exactly the server's word, that the server's reader gives it back unchanged, and that the fixtures cover every server word and no other; a sixth case drives the train-proved `merged` line through both. The pin depends on Task 1's form (early dispatch, `gh pr view <n>` with `<n>` as `$3`, the flattened `mergeCommit`), so it cannot be run or shown red from this task alone.
- Note: `pr-number-check-shared-with-prLanding` (accepted, no number). The new builder's pr check is the same grammar as `prLanding`'s pair check (`^[1-9][0-9]{0,8}$`). To keep one definition, this task lifts it into a module-local `PR_NUMBER_RE` in `ccdargv.ts` and points `prLanding`'s check at it, with the message unchanged. That touches the `prLanding` builder, which the scope ruling does not list. `ccdargv-pr-landing.test.ts` stays unchanged and green, and a new characterization case pins `prLanding`'s refusal through the shared check.

**Files:**
- Modify: `server/src/ccdargv.ts`:
  - a new exported constant `PR_STATE_PR_CAP`, beside `DOCS_CAP` and its sibling caps;
  - a module-local `PR_NUMBER_RE`, which `prLanding` also uses;
  - the `CCD_ARGV.prStatePr` builder, after `prStateProject`;
  - the `CCD_CAN.prStatePr` row, on the `prStateSession`/`prStateProject` line.
- Modify: `server/src/prstate.ts`. A new section at the end of the file, after `readPrLandingLine`: `PR_STATE_PR_MAP`, `PrStatePrWord`, `PR_STATE_PR_WORDS`, `PrStatePrFacts`, `PrStatePrRead` and `readPrStatePrLine`. It adds one import, `isHead40` from `../../shared/landing.js`. It reuses the module-local `isPlainObject`, `positiveSafe` and `QUEUE_AT_RE`.
- Modify (test tables):
  - `server/test/ccdArgvSamples.ts`: `prStatePr: ['demo', 41],`.
  - `server/test/whitelist-subset.test.ts`: `EXPECTED.prStatePr: ['pr-state', '--project', 'demo', '--pr', '41'],`.
  - `server/test/id-argv-census.test.ts`: `prStatePr: 'no-id',` in `ID_BUILDERS`.
  - `server/test/verb-gate.test.ts`: `PROBE_ARGS.prStatePr: ['x', 1],`, because the default probe `'x'` fails the pr check and would throw at module load.
- Test, new: `server/test/ccdargv-pr-state-pr.test.ts`, `server/test/prstate-pr-line.test.ts` and `server/test/ccd-pr-state-pr-words.test.ts`.
- Test, modify:
  - `server/test/ccd-can.test.ts`: one case;
  - `server/test/capsupported.test.ts`: one case;
  - `server/test/ccd-archive.test.ts`: one `toContain`;
  - `server/test/single-definition/vocabularies.test.ts`: one describe.
- Run, unmodified:
  - `server/test/ccd-verb-sets.test.ts`, `server/test/ccd-can-sites.test.ts`, `server/test/ccdargv-pr-landing.test.ts`, `server/test/ccdargv-brand.test.ts`;
  - `server/test/prstate.test.ts`, `server/test/landing-words.test.ts`, `server/test/ccd-pr-queue-words.test.ts`, `server/test/ccd-pr-state.test.ts`;
  - `agent/test/whitelist.test.ts`.
- Not modified:
  - `agent/src/whitelist.ts`: the prefix grant `['pr-state', '--project']` covers the new argv;
  - `server/src/remote/runner.ts`: `CCD_VERB_TIMEOUT_MS` is keyed by verb, so `'pr-state': 25_000` already bounds the form;
  - every `server/src` lane, route and watcher.

**Interfaces:**
- **Consumes from Task 1.** The tests read only these:
  - **argv:** `ccd pr-state --project <p> --pr <n>`, with `<n>` matching `^[1-9][0-9]{0,8}$`, in exactly that token order.
  - **caps:** `ccd caps` prints the line `pr-state-pr-v1`.
  - **gh:** the form calls `gh pr view <n> …` with `<n>` as gh's third word. That way `GH_STUB`'s `pr view` arm (keyed on `$3`) answers from `ghView(n, …)` and `ghViewFail(n, …)`.
  - **stdout:** exactly one non-empty line, a JSON object, whatever the state. The exit code is not read.
  - **the line:** Task 1's, `{"number":<n>,"state":"open|merged|closed|unmeasured|absent","reason":…, …}` (no other key names the PR), with these fields:
    - `number`: the asked PR, an integer;
    - for `open`, `closed` and `merged`:
      - `headRefOid`: 40 lowercase hex;
      - `baseRefName`: a non-empty string;
      - `isCrossRepository`: a boolean;
      - `mergedAt`: an ISO-8601 string ending in `Z`, or `null`;
      - `mergeCommit`: 40 lowercase hex (GitHub's `mergeCommit.oid`, flattened), or `null`;
    - GitHub-merged (`state: merged`, no `landedInTrain`): `mergedAt` and `mergeCommit` both non-null;
    - train-merged: `"landedInTrain": true` (GitHub read `CLOSED`, and the train proof proved it);
    - `unmeasured`: `"reason"`, one of Task 1's words (`no-remote`, `timeout`, `unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`, `unreadable`, `missing-field`, `train-unproven`, `train-unread`), which the reader passes through unchanged and never refuses, so a newer ccd's word is not folded; and at most one of `"trainUnproven": true` and `"trainUnread": true`;
    - `absent`: only the three train flags are read beside the word, and each must be false (ccd prints them false).

    Any other key is ignored.
  - **The gh input the words pin plants.** These are GitHub's own field names, not Task 1's:
    - `{ number: 41, state: 'OPEN'|'MERGED'|'CLOSED', headRefOid, baseRefName: 'main', isCrossRepository: false, mergedAt, mergeCommit: { oid } | null, labels: [] }`;
    - for unmeasured: `ghViewFail(41, 124)`, rc 124 with no stderr;
    - for absent: `ghViewFail(41)`, rc 1 with `notAPullRequest(41)`.
- **Produces (`server/src/ccdargv.ts`):**
  ```ts
  /** The `ccd caps` token that says `pr-state` takes `--project <p> --pr <n>` (landing order wave 5c; spec §5.5
   *  "Landed state is PR-keyed"). Spelled ONCE in `server/src`; ccd's echo and `ccdCapTokens.ts` are the other two
   *  spellings, held equal by `ccd-archive.test.ts`'s `toContain`. READ IT THROUGH `ccdCan(state, 'prStatePr')`:
   *  an older ccd dies on the arity of the new form, and `verbSupported(['pr-state'])` permits on every box. */
  export const PR_STATE_PR_CAP = 'pr-state-pr-v1';
  const PR_NUMBER_RE = /^[1-9][0-9]{0,8}$/;   // module-local; prLanding's pair check uses it too
  // CCD_ARGV:
  prStatePr: (p: string, pr: number | string) => {
    if (!PR_NUMBER_RE.test(String(pr))) throw new Error('CCD_ARGV.prStatePr: a pr number is a positive integer with no leading zero');
    return argv(['pr-state', '--project', p, '--pr', String(pr)]);
  },
  // CCD_CAN:
  prStatePr: capRow(PR_STATE_PR_CAP),
  ```
  `prLanding`'s pr check becomes `if (!PR_NUMBER_RE.test(String(pr))) throw …` with its message unchanged.
- **Produces (`server/src/prstate.ts`):**
  ```ts
  const PR_STATE_PR_MAP = {
    open: 'GitHub reads the PR OPEN (a draft included)',
    merged: 'GitHub reads it MERGED, or it reads CLOSED with the train claim and the train record proves it landed (landedInTrain)',
    closed: 'GitHub reads it CLOSED, and it carries no train claim',
    unmeasured: 'ccd asked and got no definite answer: a timeout, a non-zero exit, an unparsable body, a missing field, or a train claim the proof refused or could not read',
    absent: 'GitHub answered definitely that the number names no pull request in the repository',
  } as const;
  export type PrStatePrWord = keyof typeof PR_STATE_PR_MAP;
  export const PR_STATE_PR_WORDS: readonly PrStatePrWord[] = Object.keys(PR_STATE_PR_MAP) as PrStatePrWord[];
  export interface PrStatePrFacts {
    headRefOid: string; baseRefName: string; isCrossRepository: boolean; mergedAt: string | null; mergeCommit: string | null;
  }
  export type PrStatePrRead =
    | { state: 'open' | 'closed'; pr: number; facts: PrStatePrFacts; train: null }
    | { state: 'merged'; pr: number; facts: PrStatePrFacts; train: 'proved' | null }
    | { state: 'unmeasured'; pr: number; by: 'ccd' | 'reader'; reason: string; train: 'unproven' | 'unread' | null }
    | { state: 'absent'; pr: number };
  /** The ONE reader of the PR-keyed form's stdout, for the PR `pr` the caller asked about; the line's `number` must equal it. Pure. */
  export function readPrStatePrLine(stdout: string, pr: number): PrStatePrRead;
  ```
  - **The reader's order.** It stops at the first rule that fails. Every refusal is `{ state: 'unmeasured', pr, by: 'reader', reason, train: null }`:
    1. The stdout does not hold exactly one non-empty line: `line-count`.
    2. `JSON.parse` throws, or the value is not a plain object: `not-json`.
    3. `number` is not `positiveSafe`, or not equal to the asked `pr`: `pr-mismatch`.
    4. `state` is not a string in `PR_STATE_PR_WORDS`: `word`.
    5. `absent` with any of `landedInTrain`, `trainUnproven` and `trainUnread` true answers `train-flags`; otherwise `{ state: 'absent', pr }`.
    6. `unmeasured` with both train flags true answers `train-flags`. Otherwise it answers `{ state: 'unmeasured', pr, by: 'ccd', reason, train }`:
       - `reason` is the line's non-empty string, else `'unstated'`;
       - `train` is `'unread'` for `trainUnread === true`, `'unproven'` for `trainUnproven === true`, else `null`.
    7. For `open`, `closed` and `merged`:
       - a `trainUnproven`/`trainUnread` true, or a `landedInTrain` true on a state other than `merged`, answers `train-flags`;
       - otherwise `headRefOid` must be `typeof === 'string' && isHead40(...)` (the line's fields are `unknown` after `JSON.parse`, and `isHead40` takes a `string`), `baseRefName` a non-empty string, `isCrossRepository` a boolean, `mergedAt` null or (`typeof === 'string' && QUEUE_AT_RE.test(...)`), and `mergeCommit` null or (`typeof === 'string' && isHead40(...)`). If not, it answers `fields`.
       - `open` and `closed` require `mergedAt === null && mergeCommit === null`, else `fields`.
       - `merged` without `landedInTrain` requires both non-null, else `fields`.
       - `merged` with `landedInTrain` answers `train: 'proved'`.
  - **Rings:** `prstate.ts` stays L1, context C4. Its new import is L0 (`shared/landing.ts`), so the edge points inward.
  - **Wire:** no `FleetSession` field and no frame change. `FLEET_PROTO` is untouched.

- [ ] **Step 1: The failing tests.**
  - **`server/test/ccdargv-pr-state-pr.test.ts`** (new, in the shape of `ccdargv-pr-landing.test.ts`):
    ```ts
    import { describe, it, expect } from 'vitest';
    import { CCD_ARGV } from '../src/ccdargv.js';
    describe('CCD_ARGV.prStatePr (landing order wave 5c)', () => {
      it('the argv is pr-state --project p --pr n, the project before the number', () => {
        expect([...CCD_ARGV.prStatePr('project-a', 41)]).toEqual(['pr-state', '--project', 'project-a', '--pr', '41']);
        expect([...CCD_ARGV.prStatePr('project-a', '41')]).toEqual(['pr-state', '--project', 'project-a', '--pr', '41']);
        expect(CCD_ARGV.prStatePr('project-a', 999_999_999)[4]).toBe('999999999');
      });
      it('refuses a pr that is not a positive integer with no leading zero', () => {
        for (const pr of [0, -1, 1.5, '041', '1e3', '', ' 41', '41 ', 1_000_000_000, Number.NaN]) {
          expect(() => CCD_ARGV.prStatePr('project-a', pr as number), String(pr)).toThrow(/positive integer with no leading zero/);
        }
      });
      it('prLanding keeps its own refusal through the shared check (characterization, green before and after)', () => {
        expect(() => CCD_ARGV.prLanding('project-a', [{ id: 'a', pr: '041' }])).toThrow(/positive integer with no leading zero/);
      });
    });
    ```
  - **`server/test/ccd-can.test.ts`**: add `PR_STATE_PR_CAP` to the import, and this case in the describe "ccdCan(state, row) answers by the row's own token and default (D-5866)":
    ```ts
    it('prStatePr refuses on no evidence and answers by pr-state-pr-v1 alone, never by the pr-state verb (landing order wave 5c)', () => {
      expect(CCD_CAN.prStatePr).toEqual({ token: 'pr-state-pr-v1', default: 'refuse' });
      expect(CCD_ARGV.prStatePr('demo', 41)[0]).toBe(CCD_ARGV.prStateProject('demo')[0]);
      expect(ccdCan(undefined, 'prStatePr')).toBe(false);
      expect(ccdCan(stateOf(null), 'prStatePr')).toBe(false);
      expect(ccdCan(stateOf([]), 'prStatePr')).toBe(false);
      expect(ccdCan(stateOf(['pr-state', 'caps']), 'prStatePr'), 'the bare verb is not the token').toBe(false);
      expect(ccdCan(stateOf(['pr-state', 'caps']), 'prStateProject'), 'CONTROL: the older form still permits on its verb').toBe(true);
      expect(ccdCan(stateOf([PR_STATE_PR_CAP]), 'prStatePr')).toBe(true);
    });
    ```
  - **`server/test/capsupported.test.ts`**: add `PR_STATE_PR_CAP` to the import, and this case in the describe "capSupported":
    ```ts
    it('spells the pr-state-pr token exactly once in server/src, and it REFUSES on no evidence (landing order wave 5c)', () => {
      expect(PR_STATE_PR_CAP).toBe('pr-state-pr-v1');
      expect(literalSpellings(PR_STATE_PR_CAP)).toBe(1);
      expect(capSupported(state(null), PR_STATE_PR_CAP)).toBe(false);
      expect(capSupported(undefined, PR_STATE_PR_CAP)).toBe(false);
      expect(capSupported(state(['pr-state']), PR_STATE_PR_CAP), 'the verb is not the token').toBe(false);
      expect(capSupported(state([PR_STATE_PR_CAP]), PR_STATE_PR_CAP)).toBe(true);
      expect(verbSupported(state(null), ['pr-state'])).toBe(true);
    });
    ```
  - **`server/test/ccd-archive.test.ts`**:
    - add `PR_STATE_PR_CAP` to its `../src/ccdargv.js` import;
    - add `expect(KNOWN_CAPABILITY_TOKENS).toContain(PR_STATE_PR_CAP);` after `toContain(COLLECT_CAP)` in "advertises exactly the verbs the dispatcher implements, plus the known capability tokens";
    - add the comment line `// Landing order wave 5c's token: the third spelling of the PR-keyed pr-state form's capability.`
  - **The four test tables:** add the rows named in Files. `ccdArgvSamples.ts` and `id-argv-census.test.ts` are total `Record`s, so a missing row is a `tsc` error.
  - **`server/test/prstate-pr-line.test.ts`** (new):
    ```ts
    import { describe, it, expect } from 'vitest';
    import { PR_STATE_PR_WORDS, readPrStatePrLine } from '../src/prstate.js';
    const HEAD = 'a'.repeat(40); const MERGE = 'b'.repeat(40); const AT = '2026-10-30T12:00:00Z';
    const line = (o: Record<string, unknown>): string => `${JSON.stringify({ number: 41, ...o })}\n`;
    const FACTS = { headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null };
    const reader = (reason: string) => ({ state: 'unmeasured', pr: 41, by: 'reader', reason, train: null });

    describe('the PR-keyed pr-state words (landing order wave 5c)', () => {
      it('are five, in the map\'s order', () => {
        expect(PR_STATE_PR_WORDS).toEqual(['open', 'merged', 'closed', 'unmeasured', 'absent']);
      });
    });

    describe('readPrStatePrLine keeps every distinction (landing order wave 5c)', () => {
      it('open and closed carry their facts and no train', () => {
        expect(readPrStatePrLine(line({ state: 'open', ...FACTS }), 41)).toEqual({ state: 'open', pr: 41, facts: FACTS, train: null });
        expect(readPrStatePrLine(line({ state: 'closed', ...FACTS, isCrossRepository: true }), 41))
          .toEqual({ state: 'closed', pr: 41, facts: { ...FACTS, isCrossRepository: true }, train: null });
      });
      it('merged by GitHub carries mergedAt and mergeCommit; merged by the train says proved', () => {
        const gh = { ...FACTS, mergedAt: AT, mergeCommit: MERGE };
        expect(readPrStatePrLine(line({ state: 'merged', ...gh }), 41)).toEqual({ state: 'merged', pr: 41, facts: gh, train: null });
        expect(readPrStatePrLine(line({ state: 'merged', ...FACTS, landedInTrain: true }), 41))
          .toEqual({ state: 'merged', pr: 41, facts: FACTS, train: 'proved' });
      });
      it('absent stays absent beside false train flags and any other field, and is never unmeasured', () => {
        expect(readPrStatePrLine(line({ state: 'absent' }), 41)).toEqual({ state: 'absent', pr: 41 });
        expect(readPrStatePrLine(line({ state: 'absent', landedInTrain: false, trainUnproven: false, trainUnread: false }), 41))
          .toEqual({ state: 'absent', pr: 41 });
        expect(readPrStatePrLine(line({ state: 'absent', headRefOid: 'junk', reason: 'x' }), 41)).toEqual({ state: 'absent', pr: 41 });
      });
      it('ccd\'s own unmeasured keeps its reason and its train word, marked by ccd', () => {
        expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'timeout' }), 41))
          .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'timeout', train: null });
        expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'rate-limit' }), 41))
          .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'rate-limit', train: null });
        expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'train-unread', trainUnread: true }), 41))
          .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'train-unread', train: 'unread' });
        expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'train-unproven', trainUnproven: true }), 41))
          .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'train-unproven', train: 'unproven' });
        expect(readPrStatePrLine(line({ state: 'unmeasured' }), 41))
          .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'unstated', train: null });
      });
      it.each([
        ['an empty stdout', '', 'line-count'],
        ['two lines', line({ state: 'open', ...FACTS }) + line({ state: 'open', ...FACTS }), 'line-count'],
        ['not JSON', 'not json\n', 'not-json'],
        ['an array', '[]\n', 'not-json'],
        ['another pr', line({ number: 42, state: 'open', ...FACTS }), 'pr-mismatch'],
        ['no number', `${JSON.stringify({ state: 'open', ...FACTS })}\n`, 'pr-mismatch'],
        ['a string number', line({ number: '41', state: 'open', ...FACTS }), 'pr-mismatch'],
        ['an unknown word', line({ state: 'gone', ...FACTS }), 'word'],
        ['GitHub\'s own spelling', line({ state: 'OPEN', ...FACTS }), 'word'],
        ['open with no headRefOid', line({ state: 'open', ...FACTS, headRefOid: undefined }), 'fields'],
        ['open with a short headRefOid', line({ state: 'open', ...FACTS, headRefOid: 'abc1234' }), 'fields'],
        ['a string isCrossRepository', line({ state: 'open', ...FACTS, isCrossRepository: 'false' }), 'fields'],
        ['an empty baseRefName', line({ state: 'closed', ...FACTS, baseRefName: '' }), 'fields'],
        ['open with a mergedAt', line({ state: 'open', ...FACTS, mergedAt: AT }), 'fields'],
        ['GitHub-merged with no mergeCommit', line({ state: 'merged', ...FACTS, mergedAt: AT }), 'fields'],
        ['merged with a malformed mergedAt', line({ state: 'merged', ...FACTS, mergedAt: '30 Oct', mergeCommit: MERGE }), 'fields'],
        ['closed claiming the train', line({ state: 'closed', ...FACTS, landedInTrain: true }), 'train-flags'],
        ['open beside trainUnproven', line({ state: 'open', ...FACTS, trainUnproven: true }), 'train-flags'],
        ['open claiming the train', line({ state: 'open', ...FACTS, landedInTrain: true }), 'train-flags'],
        ['closed beside trainUnread', line({ state: 'closed', ...FACTS, trainUnread: true }), 'train-flags'],
        ['merged beside trainUnproven', line({ state: 'merged', ...FACTS, landedInTrain: true, trainUnproven: true }), 'train-flags'],
        ['closed with a mergeCommit', line({ state: 'closed', ...FACTS, mergeCommit: MERGE }), 'fields'],
        ['GitHub-merged with no mergedAt', line({ state: 'merged', ...FACTS, mergeCommit: MERGE }), 'fields'],
        ['a short mergeCommit', line({ state: 'merged', ...FACTS, mergedAt: AT, mergeCommit: 'abc' }), 'fields'],
        ['a numeric baseRefName', line({ state: 'open', ...FACTS, baseRefName: 7 }), 'fields'],
        ['merged beside trainUnread', line({ state: 'merged', ...FACTS, landedInTrain: true, trainUnread: true }), 'train-flags'],
        ['unmeasured with both train flags', line({ state: 'unmeasured', reason: 'x', trainUnread: true, trainUnproven: true }), 'train-flags'],
        ['absent claiming the train', line({ state: 'absent', landedInTrain: true }), 'train-flags'],
        ['absent beside trainUnread', line({ state: 'absent', trainUnread: true }), 'train-flags'],
      ])('%s is the reader\'s unmeasured: %s', (_what, stdout, reason) => {
        expect(readPrStatePrLine(stdout, 41)).toEqual(reader(reason));
      });
    });
    ```
  - **`server/test/ccd-pr-state-pr-words.test.ts`** (new). It runs the real `ccd` under `makePrHarness` and `GH_STUB`, in a fixture HOME only:
    ```ts
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { GH_STUB, makePrHarness, trainComment, trainRow, type PrHarness } from './ccdPrHelpers.js';
    import { PR_STATE_PR_WORDS, readPrStatePrLine } from '../src/prstate.js';

    let h: PrHarness;
    beforeEach(() => { h = makePrHarness('ccrc-ccd-prstate-pr-words-'); });
    afterEach(() => { h.cleanup(); });

    const HEAD = 'a'.repeat(40); const MERGE = 'b'.repeat(40);
    const view = (state: string, over: Record<string, unknown> = {}) => ({ number: 41, state, headRefOid: HEAD,
      baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null, labels: [], ...over });
    /** One GitHub answer per server word. The train-proved `merged` arm is its own case below. */
    const FIXTURES: readonly (readonly [string, (p: PrHarness) => void])[] = [
      ['open', (p) => p.ghView(41, view('OPEN'))],
      ['merged', (p) => p.ghView(41, view('MERGED', { mergedAt: '2026-10-30T12:00:00Z', mergeCommit: { oid: MERGE } }))],
      ['closed', (p) => p.ghView(41, view('CLOSED'))],
      ['unmeasured', (p) => p.ghViewFail(41, 124)],
      ['absent', (p) => p.ghViewFail(41)],
    ];
    const printedLine = (stdout: string): Record<string, unknown> => {
      const lines = stdout.split('\n').filter(Boolean);
      expect(lines, 'exactly one JSON line').toHaveLength(1);
      return JSON.parse(lines[0]!) as Record<string, unknown>;
    };

    describe('ccd\'s PR-keyed pr-state words are the server\'s (landing order wave 5c)', () => {
      it('the fixtures cover every server word, and no other', () => {
        expect(FIXTURES.map(([w]) => w).sort()).toEqual([...PR_STATE_PR_WORDS].sort());
      });
      it.each(FIXTURES)('the %s fixture prints exactly that word, and the server reads it back unchanged', (word, plant) => {
        h.makeGhRepo('demo');
        plant(h);
        const r = h.run(`${GH_STUB} cmd_pr_state --project demo --pr 41`);
        expect(printedLine(r.stdout).state).toBe(word);
        expect(readPrStatePrLine(r.stdout, 41).state).toBe(word);
      });
      it('the train-proved line is merged, proved, on both sides', () => {
        h.makeGhRepo('demo');
        h.ghView(41, { ...view('CLOSED', { labels: [{ name: 'landed-in-train' }] }), ...trainComment(50) });
        h.ghView(50, trainRow(50, 'e'.repeat(40), [[41, HEAD]]));
        const r = h.run(`${GH_STUB} cmd_pr_state --project demo --pr 41`);
        expect(printedLine(r.stdout).state).toBe('merged');
        expect(readPrStatePrLine(r.stdout, 41)).toMatchObject({ state: 'merged', train: 'proved' });
      });
      it('CONTROL: with no stub the poisoned gh answers, and the line is unmeasured, never absent', () => {
        h.makeGhRepo('demo');
        const r = h.run('cmd_pr_state --project demo --pr 41');
        expect(printedLine(r.stdout).state).toBe('unmeasured');
        expect(h.ghPoison().length).toBeGreaterThan(0);
      });
    });
    ```
  - **`server/test/single-definition/vocabularies.test.ts`**: add `PR_STATE_PR_WORDS` from `../../src/prstate.js` to the imports, and this describe at the end of the file. It uses `RegExp.test` only, never `toContain`/`toMatch` on source text, so `advance-switches`' exact `literalSourcePinScan` ceilings (`'server/src/prstate.ts': 2`, `'server/src/ccdargv.ts': 6`) do not move:
    ```ts
    describe('landing order wave 5c — the PR-keyed pr-state words, defined once and derived', () => {
      const PRSTATE = path.join(ccrcRoot, 'server/src/prstate.ts');
      it('PR_STATE_PR_MAP and PR_STATE_PR_WORDS are declared in exactly one file, prstate.ts', () => {
        expect(ALL.filter((f) => /^\s*const PR_STATE_PR_MAP\b/m.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['server/src/prstate.ts']);
        expect(ALL.filter((f) => /^\s*export const PR_STATE_PR_WORDS\b/m.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['server/src/prstate.ts']);
      });
      it('DERIVES the list from the map, never a hand-written array', () => {
        const DERIVED = /export const PR_STATE_PR_WORDS: readonly PrStatePrWord\[\] =\s*\n?\s*Object\.keys\(PR_STATE_PR_MAP\)/;
        expect(DERIVED.test(readFileSync(PRSTATE, 'utf8'))).toBe(true);
        expect(/PR_STATE_PR_WORDS(?::[^=\n]*)?=\s*\[/.test(readFileSync(PRSTATE, 'utf8'))).toBe(false);  // the name, an optional same-line type annotation, then '= ['
      });
      it('spells four or more of the five nowhere as a free-standing list', () => {
        const M = `(?:${PR_STATE_PR_WORDS.join('|')})`;
        const LIST = new RegExp(`\\[\\s*'${M}'\\s*(?:,\\s*'${M}'\\s*){${PR_STATE_PR_WORDS.length - 2},}\\]`);
        expect(LIST.test(`['${[...PR_STATE_PR_WORDS].reverse().join("', '")}']`), 'CONTROL: the five, reversed').toBe(true);
        expect(LIST.test(`['${PR_STATE_PR_WORDS.slice(1).join("','")}']`), 'CONTROL: four of them').toBe(true);
        expect(LIST.test("['open', 'merged', 'closed']"), 'CONTROL: three is not a list of these').toBe(false);
        expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
      });
    });
    ```
    `path`, `readFileSync`, `ALL`, `rel` and `ccrcRoot` are already imported or exported by `./helpers.js`. Check this file's import block, and add only what is missing. Measured on origin/main: no file under `ROOTS` (`shared`, `server/src`, `pwa/src`, `agent/src` in `helpers.ts`) spells four of `open|merged|closed|unmeasured|absent` as a quoted list, so the free-list scan is green before the change. `server/test` is not in `ROOTS`, so the tests' own lists (such as the five-word list in `prstate-pr-line.test.ts`) are exempt.
- [ ] **Step 2: Run the tests and see the expected failures.** From `server/`:
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccdargv-pr-state-pr.test.ts test/prstate-pr-line.test.ts test/ccd-pr-state-pr-words.test.ts`. Expected: every case in `ccdargv-pr-state-pr.test.ts` except the `prLanding` case (a characterization, green before and after) fails with `CCD_ARGV.prStatePr is not a function`. Every case in `prstate-pr-line.test.ts` fails with `readPrStatePrLine is not a function` or an undefined `PR_STATE_PR_WORDS`. Every case in `ccd-pr-state-pr-words.test.ts` fails: the fixtures-cover case on an undefined `PR_STATE_PR_WORDS`, the others on `readPrStatePrLine is not a function` after ccd has printed its line. Vitest does not typecheck, and a missing named export is `undefined`, not an import error. The words pin is red-first only once Task 1's ccd form exists; with Task 1 absent, the real ccd dies on arity first.
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-can.test.ts test/capsupported.test.ts test/ccd-archive.test.ts test/single-definition/vocabularies.test.ts`. Expected:
    - the four new cases are red: `CCD_CAN.prStatePr` is undefined, `PR_STATE_PR_CAP` is undefined, and `toContain(undefined)`;
    - the three new vocabularies cases are red, because no file declares the map;
    - every other case keeps its count on main. Record those counts.
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/verb-gate.test.ts test/whitelist-subset.test.ts test/id-argv-census.test.ts`. Expected: these run green or fail only on the new rows' missing builder. Record which.
- [ ] **Step 3: Implement** the Interfaces block:
  - In `ccdargv.ts`:
    - `PR_STATE_PR_CAP` with its docstring verbatim (backticks only, so `literalSpellings` counts 1);
    - `PR_NUMBER_RE`, which `prLanding`'s pr check now uses;
    - the `prStatePr` builder, with a docstring: "Landing order wave 5c (spec §5.5 \"Landed state is PR-keyed\"): one PR's state by number, with no workspace binding. Sent only behind `PR_STATE_PR_CAP` (`CCD_CAN`'s `capRow`): an older ccd dies on this form's arity. The pr is refused here as `prLanding` refuses its pairs.";
    - `CCD_CAN`'s `prStatePr: capRow(PR_STATE_PR_CAP),` on the `prStateSession`/`prStateProject` line.
  - In `prstate.ts`: the new section under the banner `// ── \`ccd pr-state --project <p> --pr <n>\` (landing order wave 5c; spec §5.5 "Landed state is PR-keyed") ──`. Its map and reader follow the reader's order exactly.
  - The test tables' rows.

  Cite code by symbol in every comment, never by file and line.
- [ ] **Step 4: Run the tests and see them pass.** From `server/`, one command per group:
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccdargv-pr-state-pr.test.ts test/ccdargv-pr-landing.test.ts test/prstate-pr-line.test.ts test/prstate.test.ts test/landing-words.test.ts`
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-can.test.ts test/capsupported.test.ts test/verb-gate.test.ts test/whitelist-subset.test.ts test/id-argv-census.test.ts test/ccdargv-brand.test.ts`
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-archive.test.ts`, then `test/ccd-verb-sets.test.ts`, then `test/ccd-pr-state-pr-words.test.ts`, then `test/ccd-pr-queue-words.test.ts`. One file per run, because they shell the real `ccd`.
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-can-sites.test.ts` (unchanged).
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-pr-state.test.ts`, alone and unchanged: it shows the two older forms still answer.
  - From `agent/`: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/whitelist.test.ts`, unchanged.
- [ ] **Step 5: The guards.** From `server/`:
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/single-definition/*.test.ts`. The `advance-switches` ceilings must not move. A red there means a new test pins source text: rewrite it with `RegExp.test`, never raise the ceiling.
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/rings/*.test.ts test/citations.test.ts test/anchors.test.ts test/docs-parity.test.ts`.
  - `git fetch origin main`, then `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/deviation-refs.test.ts`. This task's code defines and cites no D-number.
  - `GROWTH_CHECK=1 ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/growth-check.test.ts`. `ccdargv.ts` and `prstate.ts` are not growth-listed, so expect no new row from this task.
  - `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=1 test/typecheck-tests.test.ts`, alone.
  - From `server/`: `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`
- [ ] **Step 6: Mutations.** Run each row of the table under the Global Constraints:
  - sequentially, bounded with `timeout -k` and a measured `ulimit -u`;
  - each file restored from a saved copy with its sha256 checked, never `git checkout`;
  - each row's log under `.superpowers/sdd/`.

  Row 5C-SERVER-15 mutates Task 1's `ccd/ccd` text. Claim `ccd/ccd` for that row alone, and run nothing against the live HOME.
- [ ] **Step 7: Commit:** `feat(prstate): the PR-keyed pr-state capability, its brand and its five words (landing order wave 5c)`

**Mutation table (Task 2).**

| # | Mutation | Predicted red |
|---|---|---|
| 5C-SERVER-1 | `CCD_CAN.prStatePr: verbRow('pr-state')`. | `ccd-can` "prStatePr refuses on no evidence and answers by pr-state-pr-v1 alone…": `toEqual({ token: 'pr-state-pr-v1', default: 'refuse' })` receives `{ token: 'pr-state', default: 'permit' }`, and `ccdCan(undefined, 'prStatePr')` is true. `verb-gate`'s CCD_CAN rows stay green: a permit row whose token is its verb is legal there. So this case is the only guard of the capRow choice (survey risk 5). |
| 5C-SERVER-2 | `CCD_CAN.prStatePr: 'none'`, with the `verb-gate` `PROBE_ARGS` row in place. | The same `ccd-can` case. Also `verb-gate` "a row is ungated ('none') exactly when its verb is in UNGATED_BY_DECISION", because `pr-state` is not in that set. |
| 5C-SERVER-3 | `CCD_CAN.prStatePr: capRow('pr-state-pr-v1')`: a second literal beside the constant. | `capsupported` "spells the pr-state-pr token exactly once…": `literalSpellings` answers 2. |
| 5C-SERVER-4 | `PR_STATE_PR_CAP = 'pr-state-v1'`. | `capsupported`: `toBe('pr-state-pr-v1')`. `ccd-archive` "advertises exactly…": `toContain(PR_STATE_PR_CAP)` against a list that holds `pr-state-pr-v1`. `ccd-can`'s `toEqual` on the row. |
| 5C-SERVER-5 | Delete `'pr-state-pr-v1'` from `ccdCapTokens.ts`. Red only once Task 1's `cmd_caps` echo is in the tree. | `ccd-archive` "advertises exactly the verbs the dispatcher implements, plus the known capability tokens": ccd's caps list holds a token the known list does not, and its `toContain` fails too. `ccd-verb-sets` "cmd_caps advertises exactly the dispatched verbs…" (this part needs the echo): the token is read as a verb with no dispatcher arm. The `ccd-archive` part reds on the missing `toContain` alone. |
| 5C-SERVER-6 | The builder emits `['pr-state', '--pr', String(pr), '--project', p]`. | `whitelist-subset` layer 2 case `prStatePr`: `isExecAllowed` is false, because neither `['pr-state', '--project']` nor `['pr-state', '--session']` is a prefix. Layer 2c `prStatePr builds the exact argv`. `ccdargv-pr-state-pr` "the argv is pr-state --project p --pr n…". |
| 5C-SERVER-7 | Delete the builder's `PR_NUMBER_RE` check. | `ccdargv-pr-state-pr` "refuses a pr that is not a positive integer with no leading zero": `'041'` (or `0`) builds without throwing. |
| 5C-SERVER-8 | In `readPrStatePrLine`, answer `absent` as `{ state: 'unmeasured', pr, by: 'ccd', reason: 'absent', train: null }`. This is the overloaded fold. | `prstate-pr-line` "absent stays absent…". `ccd-pr-state-pr-words` "the absent fixture prints exactly that word, and the server reads it back unchanged", at `readPrStatePrLine(...).state`. |
| 5C-SERVER-9 | Rule 4 becomes `typeof state !== 'string'` (any string passes). | `prstate-pr-line` "an unknown word…" and "GitHub's own spelling…". They receive a non-reader shape where `reader('word')` is expected. The words pin stays green, so this row shows the reader case is needed. |
| 5C-SERVER-10 | Drop rule 3's equality of `number` with the asked `pr`. | `prstate-pr-line` "another pr is the reader's unmeasured: pr-mismatch". |
| 5C-SERVER-11 | Replace `typeof headRefOid === 'string' && isHead40(headRefOid)` with `typeof headRefOid === 'string'`. | `prstate-pr-line` "open with a short headRefOid…: fields". |
| 5C-SERVER-12 | Drop the requirement that GitHub-merged carries `mergedAt` and `mergeCommit`. | `prstate-pr-line` "GitHub-merged with no mergeCommit…: fields". |
| 5C-SERVER-13 | Ignore `trainUnread`/`trainUnproven` on `open`, `closed` and `merged`. | `prstate-pr-line` "merged beside trainUnread…: train-flags", "merged beside trainUnproven…", "open beside trainUnproven…" and "closed beside trainUnread…". ("open claiming the train…" and "closed claiming the train…" stay green: the `landedInTrain` rule refuses them.) |
| 5C-SERVER-14 | Rename the map key `absent` to `missing` on the server only. | `prstate-pr-line` "are five, in the map's order". `ccd-pr-state-pr-words` "the fixtures cover every server word, and no other", and its absent fixture: ccd prints `absent`, which the server now reads as `reader('word')`. |
| 5C-SERVER-15 | On the ccd side only (Task 1's text in `ccd/ccd`, restored from a saved copy; depends on Task 1's form, so it cannot be run without it), print `not-found` where the form prints `absent`. | `ccd-pr-state-pr-words` "the absent fixture prints exactly that word…", at `expect(printedLine(r.stdout).state).toBe('absent')`. `prstate-pr-line` stays green. That shows the pin is the one guard that crosses the two languages. |
| 5C-SERVER-16 | `export const PR_STATE_PR_WORDS = ['open', 'merged', 'closed', 'unmeasured', 'absent'] as const;` | `vocabularies` "DERIVES the list from the map…": `DERIVED.test` is false and the hand-array regex is true. Also "spells four or more of the five nowhere as a free-standing list": `prstate.ts` holds the list. |
| 5C-SERVER-17 | Plant `const X = ['absent', 'open', 'closed', 'merged'];` in `server/src/coord/radar.ts`. | `vocabularies` "spells four or more of the five nowhere as a free-standing list", naming `server/src/coord/radar.ts`. |
| 5C-SERVER-18 | Drop `${GH_STUB}` from the pin's `it.each` snippet. | `ccd-pr-state-pr-words`: the open, merged, closed and absent fixtures. The poisoned `gh` answers, so ccd prints `unmeasured` for all four. This shows the stub carries the fixtures, so the pin cannot pass vacuously. |
| 5C-SERVER-19 | Mutate the shared `PR_NUMBER_RE` to `/^[0-9]{1,9}$/`. | `ccdargv-pr-state-pr` "refuses a pr that is not a positive integer…" on `'041'` and `0`, and the `prLanding` characterization case on `'041'`. |
| 5C-SERVER-20 | Drop the `mergeCommit === null` half of the open/closed requirement. | `prstate-pr-line` "closed with a mergeCommit: fields". |
| 5C-SERVER-21 | Rule 5 answers `{ state: 'absent', pr }` whatever the train flags say. | `prstate-pr-line` "absent claiming the train…: train-flags" and "absent beside trainUnread…". |

### Task 3: the carried text and the rules read

Four carried items ride with this sub-wave because it edits their files (scope-5c "Carried items"): wave 3d review 759 F1, F6 and F7, and wave 3b review 1109 (the landing-rules read in `ccd/ccd` takes one page). All sites were measured on `origin/main` at `70822435f`.

**Where F1 stands on main** (`git grep -n -i "second before" origin/main`; the plans and `docs/superpowers/programs/landing-order.md` are dated history and stay as written):

| Site | Text on main |
|---|---|
| `ccd/ccd`, the queue-block header above `PR_GH_QUEUE_TIMEOUT` | "at or one second before the PR reads MERGED (16 of 16 queue merges, measured 2026-10-21), so the add is never the last act of a landed PR" |
| `server/test/ccd-pr-queue.test.ts`, the comment above `describe('the removal\'s reason (landing-order wave 3d)'` (this is "the `ccd-pr-queue` comment": it is a test file, not a path named `ccd-pr-queue`) | "at or one second before the PR reads MERGED (16 of 16 queue merges, measured 2026-10-21)" |
| spec `2026-09-23-landing-order-and-main-churn-design.md` §5.2, the wave 3d amendment of the query bullet | "at or one second before the PR reads MERGED, so the add is never a landed PR's last act" |
| `README.md`, the native-merge-queue paragraph | "at or **a** second before the PR reads merged" (a `git grep "one second before"` misses this one) |
| `server/src/prstate.ts`, the doc comment of `PR_QUEUE_MAP` (the `landed` gloss) | "`landed` can name a line whose phase still reads open, for the second before GitHub reads the PR merged" |

D-6216 (from the 3d plan's Deviations) gives the measurement: 22 queue merges, of which 14 recorded the removal in the merge's own second, 7 one second before and 1 one second after. The second clause in ccd and in the spec ("so the add is never … last act") is false for the same reason. In the second after the merge, the PR reads MERGED and its last act is still the add, which the kept MERGED-plus-add arm of `word()` answers as `landed`.

**F6, both texts quoted.** The query bullet (spec §5.2) says: "the last queue act of either kind, `ADDED_TO_MERGE_QUEUE_EVENT` or `REMOVED_FROM_MERGE_QUEUE_EVENT`, in `timelineItems`: a removal alone cannot tell a merged PR the queue landed after a re-enqueue from one merged by hand after a dequeue". The wave 3d amendment of the same bullet says: "GitHub records a removal with reason `merged` at every successful queue merge, … so the add is never a landed PR's last act. The query also reads the removal's `reason`." So a queue-landed PR's last act is a removal, the same kind of act as a hand merge after a dequeue. The act's kind cannot tell them apart; the `reason` does. That is the rationale the amendment disproves.

**F7.** This finding is in `server/test/ccd-pr-queue.test.ts`, the MERGED `none` `it.each` (`'none — a MERGED PR whose last queue act is a removal for any reason but merged (reason %j)'`). It has no number `7` and no list `['merged']`. Only the OPEN `dequeued` `it.each` carries those two. This task already edits that file for F1, so F7 is taken.

**Review 1109.** In `ccd/ccd#_pr_landing_rules`, the read is `r=$(_plat_timeout "$PR_LANDING_REST_TIMEOUT" gh api "repos/$repo/rules/branches/$enc" 2>/dev/null)`. It takes one page (GitHub returns 30 rules per page), and `_pr_landing_py names-rules` parses it with `doc(4)` (`json.loads` of one value). The precedent is the probe's fix round 1: `ccd/ccd-land-probe#read_checks` calls `get('repos/%s/rules/branches/%s' % (slug, enc), True)`, and `gh_get` appends `--paginate`. `json_values` splits the answer into "every JSON value in text, in order", and every value must be a list, or the read is unmeasured `gh-failed`. The fixture for that fix is `ccd-land-probe.test.ts`'s `describe('ccd-land-probe: the rules read, whole (fix round 1, review 1109 F1)')`: its stub pages the endpoint two rules at a time, and a read without `--paginate` gets the first page only.

**Files:**
- Modify: `ccd/ccd`. In `_pr_landing_rules`, the rules read gains `--paginate` and its header comment is updated. In `_pr_landing_py`, a `docs(fd)` reader is added, `doc(fd)` derives from it, and `names-rules` reads every page. The queue-block header text is reworded (F1).
- Modify: `server/src/prstate.ts`, the doc comment of `PR_QUEUE_MAP` only (F1).
- Modify: `README.md`, two lines of the native-merge-queue paragraph, with the line count kept (F1).
- Modify: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, the §5.2 query bullet (F6) and its wave 3d amendment (F1), and one amendment note at the end of §5.5's "Landed state is PR-keyed" paragraph (this wave's form).
- Modify (or create, if Task 1 did not): `server/test/growth-waivers/D-7599-pr-state-pr-form.json`, `maxDelta` re-set over the whole PR.
- Test: `server/test/ccd-pr-landing.test.ts`. The `GH` stub pages the rules endpoint, and a new describe is added (review 1109).
- Test: `server/test/ccd-pr-queue.test.ts`. The F1 comment is reworded and two rows are added to the MERGED `none` `it.each` (F7).

**Interfaces:**
```text
_pr_landing_py names-rules            # fd 4 = the stdout of `gh api repos/<slug>/rules/branches/<enc> --paginate`:
                                      #   ONE JSON array, or SEVERAL run together (one per page), whitespace between allowed
  stdout, rc 0: {"names":[<str>…≤32],"cut":<bool>,"pinned":[<str>…]}   # unchanged shape (cut_list)
  rc 1, no stdout: fd 4 empty, any value not JSON, or any value not a list   # -> r="" -> unmeasured ['rules'], never cached
```
```python
def docs(fd):   # -> list (every JSON value on /dev/fd/<fd>, in order, at least one) | None (empty, or anything not JSON)
def doc(fd):    # -> the single value when docs(fd) holds exactly one, else None   (unchanged meaning for every other mode)
```
The bash call becomes `gh api "repos/$repo/rules/branches/$enc" --paginate`. `--paginate` comes AFTER the path, so `$1 $2` stays `api repos/…`, and the read-only census in `ccd-pr-landing.test.ts` still finds `argv[1]` to be the path and no `-X`/`--method`. The read stays under `PR_LANDING_REST_TIMEOUT` (4 s) for every page together. `pr-timeout-budget.test.ts`'s pr-landing pin (`_plat_timeout "\$PR_LANDING_[A-Z]+_TIMEOUT" gh` counted 3 times) does not change.

- [ ] **Step 1: page the `GH` stub in `ccd-pr-landing.test.ts`.** Add a first arm inside the `'api repos/o/r/rules/branches/'*)` case, before the existing `rules-<base>.json`/`rules.json` reads, so every existing test answers exactly as before:
```bash
      if [[ -f "$HOME/rules-page1.json" ]]; then cat "$HOME/rules-page1.json"; [[ " $* " == *' --paginate '* ]] && cat "$HOME/rules-page2.json"; return "$rc"; fi
```
Then extend the stub's doc comment with: "With `rules-page1.json` present, the rules endpoint pages: a read with `--paginate` gets page 1 and then page 2, run together as gh prints them; a read without it gets page 1 alone, as GitHub's thirty-rule page would."

- [ ] **Step 2: write the failing tests.** Add a new describe after `describe('the rules cache'`:
```ts
describe('the rules read, every page (review 1109)', () => {
  const REQ = (context: string): Ctx => ({ type: 'required_status_checks', parameters: { required_status_checks: [{ context }] } });
  const rulesCalls = (): string[][] => calls().filter((c) => c[0] === 'api' && (c[1] ?? '').startsWith('repos/o/r/rules/'));
  const cacheFile = (): string => path.join(h.home, '.cc-sessions', 'pr-landing', 'demo.rules.main.json');
  const setup = (): void => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')])]));
    put('branch.json', { protected: false });
  };

  it('a required_status_checks rule only on the second page is named: a full first page never reads as the whole set', () => {
    setup();
    // The stub's page holds two rules, as GitHub's holds thirty: the required rule is the third, so on page 2.
    put('rules-page1.json', [{ type: 'pull_request', parameters: {} }, { type: 'deletion' }]);
    put('rules-page2.json', [REQ('e2e')]);
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.rulesNamed).toEqual(['e2e']);
    expect(l.unmeasured).toEqual([]);
    expect(rulesCalls()).toEqual([['api', 'repos/o/r/rules/branches/main', '--paginate']]);
    expect(JSON.parse(fs.readFileSync(cacheFile(), 'utf8')).rules.names).toEqual(['e2e']);
  });

  it('several pages are one set: a required rule on each page counts', () => {
    setup();
    put('rules-page1.json', [REQ('lint'), { type: 'creation' }]);
    put('rules-page2.json', [REQ('e2e')]);
    expect(landing('demo', 'demo-quiet-basin:41').lines[0]!.rulesNamed).toEqual(['lint', 'e2e']);
  });

  it.each([
    ['an object', '{"message":"Bad credentials"}'],
    ['not JSON', 'HTTP 502 <html>'],
  ])('a page that is %s makes the rules unmeasured and is never cached', (_what, page2) => {
    setup();
    put('rules-page1.json', [REQ('lint')]);
    put('rules-page2.json', page2);
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.unmeasured).toEqual(['rules']);
    expect(l.rulesNamed).toEqual([]);
    expect(l.bound).toBe(true);
    expect(fs.existsSync(cacheFile())).toBe(false);
  });
});
```
- [ ] **Step 3: run them and see them fail.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-pr-landing.test.ts`. Expected red:
  - "a required_status_checks rule only on the second page…": `expected [] to deeply equal ['e2e']`, because the read has no `--paginate`, so the stub answers page 1 alone.
  - "several pages…": `expected ['lint'] to deeply equal ['lint', 'e2e']`.
  - "a page that is an object…" and "…not JSON": red on main, because the single page reads as the whole set (`unmeasured` is `[]`, `rulesNamed` is `['lint']`, the cache is written). Green after Step 4, and red again under 5C-CARRIED-3 and 5C-CARRIED-4.
  - Every other case stays green.

- [ ] **Step 4: implement.**
  - In `_pr_landing_rules`, the read becomes `r=$(_plat_timeout "$PR_LANDING_REST_TIMEOUT" gh api "repos/$repo/rules/branches/$enc" --paginate 2>/dev/null) || r=""`.
  - Its first two comment lines become, in place:
```bash
  # Cache hit: no gh call. Miss: the rules read (`rules/branches/<base>`, every page: one holds 30 rules, review 1109)
  # and the public branch view (`branches/<base>`), each under its own timeout, both plain GETs; a failure is a miss, never cached.
```
  - In `_pr_landing_py`, put `docs` where `doc` is, and make `doc` derive from it. It is a heredoc program in another file and process from `ccd-land-probe`'s `json_values`, so it cannot import that; this is the "legitimately different" reason.
```python
def docs(fd):
    """Every JSON value on fd, in order: `gh api --paginate` prints one per page, run together (review 1109). None when
    the fd is empty or anything on it is not JSON: a rule set read in part could miss a required name."""
    try:
        with open('/dev/fd/%d' % fd) as f:
            raw = f.read()
    except OSError:
        return None
    dec, out, i, n = json.JSONDecoder(), [], 0, len(raw)
    while True:
        while i < n and raw[i] in ' \t\r\n':
            i += 1
        if i >= n:
            return out or None
        try:
            v, i = dec.raw_decode(raw, i)
        except Exception:
            return None
        out.append(v)

def doc(fd):
    vals = docs(fd)
    return vals[0] if vals is not None and len(vals) == 1 else None
```
  - The head of `names-rules` becomes:
```python
elif mode == 'names-rules':
    pages = docs(4)
    if pages is None or not all(isinstance(pg, list) for pg in pages):
        sys.exit(1)
    d = [r for pg in pages for r in pg]
```
  - The loop over `d` is unchanged.
  - `docs(fd)` catches `Exception` around `raw_decode`, as the old `doc(fd)` did around `json.loads`, so the move narrows no distinction: `rows` still reaches `sys.exit(3)` through a None answer.

- [ ] **Step 5: run and pass.** `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-pr-landing.test.ts`: every case green, including "across every fixture path the gh argvs are only graphql queries and api GETs".

- [ ] **Step 6: F7, the two missing reasons.** In `ccd-pr-queue.test.ts`, the MERGED `none` `it.each` list becomes:
```ts
  it.each([['absent'], ['manual'], ['failed_checks'], ['merge_conflict'], [null], ['some_new_reason'], ['MERGED'], [7], [['merged']]])(
```
  - The body is unchanged: `expect(o.queue).toBe('none'); expect('queueAt' in o).toBe(false);`.
  - Run: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/ccd-pr-queue.test.ts`. Both new rows are green on main; behaviour is correct, per the review's own extraction. These are coverage rows, and mutation 5C-CARRIED-5 measures that they bite.

- [ ] **Step 7: the F1 text, verbatim.**
  - `ccd/ccd` queue-block header. Replace the five lines from `# successful queue merge, at or one second before the PR reads MERGED (16 of 16` through `# type GitHub did not promise keeps the answers this block gave before it.` with these six:
```bash
# successful queue merge, within a second of the merge, either side (22 of 22
# queue merges measured 2026-10-21, D-6216), so a landed PR's last act is that
# removal, or, until the removal is recorded, the add. `reason` is a free-form
# String with no documented values; the exact text `merged` is the one this
# reads, and any other value, null or a type GitHub did not promise keeps the
# answers this block gave before it.
```
  - `server/test/ccd-pr-queue.test.ts`. The three comment lines above `describe('the removal\'s reason (landing-order wave 3d)'` become:
```ts
// Landing-order wave 3d. GitHub records a removal with reason `merged` at every successful queue merge, within a second
// of the merge, either side (22 of 22 queue merges, measured 2026-10-21, D-6216). That removal is the landing, never
// a dequeue. The reason only chooses the word: it never reaches the line.
```
  - `README.md`. The two lines `records a removal with reason \`merged\` at every successful queue merge, at or a second before the PR` / `reads merged; that removal reads \`landed\`, never \`dequeued\`, and, while the PR is open, a removal for` become (the line count is kept):
```md
records a removal with reason `merged` at every successful queue merge, within a second of the merge,
either side; that removal reads `landed`, never `dequeued`, and, while the PR is open, a removal for
```
  - `server/src/prstate.ts`. The `PR_QUEUE_MAP` doc comment becomes:
```ts
/** The merge-queue vocabulary `ccd pr-state --project` answers in (spec §5.2),
 *  ENUMERATED ONCE — the word list below is derived from it, never re-typed.
 *  Since landing-order wave 3d a removal's GitHub `reason` chooses between
 *  `dequeued` and `landed` inside ccd, and never reaches the line. GitHub
 *  records that removal within a second of the merge, either side (D-6216):
 *  `landed` can name a line whose phase still reads open, for up to that
 *  second, so no reader may take `landed` to mean phase merged. */
```
  - Spec §5.2, the amendment. Replace the text from `wave 3d: GitHub records a removal …` through `… The reason chooses the word and never reaches the line.)` with:
```md
  wave 3d: GitHub records a removal with reason `merged` at every successful queue merge, within a second of the
  merge, either side, so a landed PR's last act is that removal or, until the removal is recorded, the add. The
  query also reads the removal's `reason`. A removal with reason `merged` reads `landed`, whether the PR still
  reads open or already reads merged; any other reason, or none, keeps the answers above. The reason chooses the
  word and never reaches the line.) (Restated 2026-10-30, wave 5c: this amendment first put the removal in or
  before the merge's second and said an add could not be the final queue act of a landed PR; one of 22 queue
  merges measured on 2026-10-21 recorded it one second after (D-6216). The clause earlier in this bullet said a
  removal alone cannot tell a merged PR the queue landed after a re-enqueue from one merged by hand after a
  dequeue; it is restated, since the removal's reason, not the act's kind, is what tells them apart.)
```
  - Spec §5.5, at the end of the "Landed state is PR-keyed" paragraph (after "The coordinator's own merge step also reports the result."), append:
```md
(Amended 2026-10-30, wave 5c: five words, `absent` for GitHub's definite answer only (D-7593); the line echoes
`baseRefName`, `isCrossRepository` and the train flags, `mergeCommit` flattened to its oid (D-7594); a train claim the
proof refused or could not read is `unmeasured` (D-7596); gated by the `pr-state-pr-v1` capability.)
```
- [ ] **Step 8: the F6 text, verbatim.** In the same bullet, replace the opening four lines, from `- \`ccd pr-state\` gains one GraphQL query …` through `dequeue), separate from its \`gh pr list --json\` call, under its own bounded timeout (\`PR_GH_QUEUE_TIMEOUT\`, 4 s;`, with:
```md
- `ccd pr-state` gains one GraphQL query per repository per sweep (`pullRequest.mergeQueueEntry` and the last
  queue act of either kind, `ADDED_TO_MERGE_QUEUE_EVENT` or `REMOVED_FROM_MERGE_QUEUE_EVENT`, in `timelineItems`,
  so that a PR re-enqueued after a removal reads as queued again; since wave 3d the removal's `reason`, not the
  act's kind, tells a queue landing from a hand merge after a dequeue), separate from its `gh pr list --json`
  call, under its own bounded timeout (`PR_GH_QUEUE_TIMEOUT`, 4 s;
```
The next line (`the query measured 0.72–1.39 s), answering …`) stays as it is.

- [ ] **Step 9: check that the phrase is gone from shipped files.** Re-run it on the final text of every file edited above.
  - `git grep -n -i "at or one second before\|at or a second before\|16 of 16 queue\|never the last act of a\|never a landed PR's last act" -- ':!docs/superpowers/plans' ':!docs/superpowers/programs'` must print nothing.
  - The spec's restatement deliberately avoids the old phrase.

- [ ] **Step 10: run the suites**, each through `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <file>` from `server/`, each file whole and one at a time:
  - `test/ccd-pr-landing.test.ts`, `test/ccd-pr-queue.test.ts`, `test/ccd-pr-queue-words.test.ts`, `test/pr-timeout-budget.test.ts`;
  - the guards: `test/citations.test.ts` (no added line holds a numeric line citation), `test/anchors.test.ts`, `test/docs-parity.test.ts`, `test/deviation-refs.test.ts` (D-6216 is referenced, not defined), `test/ccd-contexts.test.ts` (no new bash function), `test/topology-clean.test.ts`;
  - the README suites `test/readme-holds.test.ts`, `test/readme-roster-mirror.test.ts` and `test/stall-settings-readme.test.ts`;
  - `GROWTH_CHECK=1` on `test/growth-check.test.ts`. `ccd/ccd` is listed, and this task adds about +12 net code lines there (`docs` about 19 and the derived `doc` 3 replace the old `doc`'s about 12, and `names-rules` gains 2). Re-measure `ccd/ccd`'s net delta over the whole PR and set `maxDelta` in `server/test/growth-waivers/D-7599-pr-state-pr-form.json` to that figure (create the file as Task 1 Step 5 spells it if Task 1 measured 40 or less and the PR now exceeds 40), in this task's first commit;
  - `test/typecheck-tests.test.ts`, alone.

- [ ] **Step 11: commit**, in two commits on the workspace branch:
  - `fix(ccd): pr-landing reads every page of the base's rules, and a page that is not a list is unmeasured (review 1109) (landing order wave 5c)`, containing `ccd/ccd`'s `_pr_landing_rules` and `_pr_landing_py`, `server/test/ccd-pr-landing.test.ts` and the re-set waiver `server/test/growth-waivers/D-7599-pr-state-pr-form.json`;
  - `docs: the merged removal is within a second of the merge, either side; §5.2's query rationale restated; the MERGED none rows carry a number and a list (review 759 F1, F6, F7) (landing order wave 5c)`, containing the queue-block header, `server/test/ccd-pr-queue.test.ts`, `server/src/prstate.ts`, `README.md` and the spec.
  - Both messages end with the `Co-Authored-By` line.

**Mutation table** (each measured: run on the mutated source, restored from a saved copy, never `git checkout`):

| id | mutation | predicted red |
|---|---|---|
| 5C-CARRIED-1 | `_pr_landing_rules`: drop `--paginate` from the rules read | "a required_status_checks rule only on the second page…" fails with `expected [] to deeply equal ['e2e']`, and `rulesCalls()` lacks `--paginate`. "several pages are one set" fails with `['lint']` vs `['lint','e2e']`. Without the flag the stub answers page 1 alone, so neither can stay green. |
| 5C-CARRIED-2 | `names-rules`: `pages = pages[:1]` after the `docs(4)` read | Both "second page" (`[]` vs `['e2e']`) and "several pages" (`['lint']` vs `['lint','e2e']`) fail: the flag is passed, but page 2 is discarded. |
| 5C-CARRIED-3 | `names-rules`: delete `or not all(isinstance(pg, list) for pg in pages)` from the guard and add the line `pages = [pg for pg in pages if isinstance(pg, list)]` after it | "a page that is an object…" fails with `expected [] to deeply equal ['rules']`, the line shows `rulesNamed: ['lint']`, and the cache file exists. The object page is dropped and page 1 reads as the whole set. |
| 5C-CARRIED-4 | `docs()`: `except Exception: return out or None` (keep the values read before a parse failure) | "a page that is not JSON…" fails with `expected [] to deeply equal ['rules']` and a written cache: page 1's `['lint']` is kept as if complete. |
| 5C-CARRIED-5 | `_pr_queue_py#word`: the landed arm becomes `… and (why == 'merged' or (state == 'MERGED' and not isinstance(why, (str, type(None))))):` | The MERGED `none` `it.each` rows `reason 7` and `reason ["merged"]` fail with `expected 'landed' to be 'none'`. Every other row stays green, including the OPEN `dequeued` rows (the arm is MERGED-only), which is exactly the gap review 759 F7 named. On main's test file the whole suite stays green under this mutation, and that measures the gap. |

### Task 4: The gate, the PR and the wave-done

**Files:** none new. This task runs the gate over Tasks 1 to 3 at the final tip, measures the whole mutation table, and reports.

- [ ] **Step 1: Every touched test file, whole.** Run each one alone, from `server/`, in the foreground: the files each task's run steps name, and at least `ccd-pr-state`, `ccd-pr-state-pr-words`, `prstate-pr-line`, `ccdargv-pr-state-pr`, `ccd-pr-landing`, `ccd-pr-queue`, `pr-timeout-budget`, `ccd-archive`, `ccd-verb-sets`, `ccd-pr-open`, `ccd-workspaces`, `capsupported`, `verb-gate`, `ccd-can`, `whitelist-subset`, `id-argv-census`, and the `train_flags` move's characterization suites, `ccd-ws-audit` and `ccd-ws-reap`. A known load flake is re-run alone once, and named in the wave-done.
- [ ] **Step 2: The repository's guards.** Run each as its own process:
  - `growth-check`, with `GROWTH_CHECK=1` after `git fetch origin main`. Report the final figure for `ccd/ccd` against the `maxDelta` Task 3 set in the waiver D-7599.
  - `deviation-refs`, after `git fetch origin main`.
  - `citations`, `anchors`, `docs-parity`, `ccd-contexts` and `ccd-can-sites`.
  - every file of `single-definition/` and `rings/`.
  - `typecheck-tests`, alone, through `ccrc test`.
  - From `server/` and then `agent/`: `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`
  - Do not run the full server suite: the merge queue runs it.
- [ ] **Step 3: The mutation table.** Measure every row of `5C-FORM`, `5C-SERVER` and `5C-CARRIED` on the final files, sequentially, under the Global Constraints' mutation rules. Report each row's measured red beside its prediction, and each recorded survivor with its reason.
- [ ] **Step 4: The PR.**
  - Open the PR from the workspace branch.
  - Its body lists D-7593 to D-7599 and every departure found during execution, and repeats `_pr_state_by_pr`'s two header sentences the Interfaces block names (the absent test, and the anchored base name).
  - Scan the body for private names before saving it.
  - Read the PR's fast run. The `plan fast server tests` job summary lists every selected server test file, so confirm each touched file is listed there. A file it does not list is left to the merge queue: say so.
- [ ] **Step 5: The wave-done.**
  - Send one wave-done at the exact final tip, with its fingerprint and the PR number.
  - Include the gate's lines, each mutation measured against its prediction, every departure, and the fast run's coverage.
  - Push nothing after the wave-done.

## Deviations found

This plan's numbers are D-7593 to D-7599, of the block D-7588 to D-7599 issued on 2026-10-30 for waves 5b and 5c. Each entry is dated 2026-10-30.

- **D-7593** — `five-words` (Task 1): the form's `state` is one of five words, `open`, `merged`, `closed`, `unmeasured` and `absent`, `absent` included. `absent` is GitHub's definite answer only (rc 1 and `Could not resolve to a PullRequest`); every other failure is `unmeasured` with a closed reason. The test is deliberately narrower than `_ws_train_record`'s, which also accepts `is not a pull request`.
- **D-7594** — `the-line-and-its-reader` (Tasks 1 and 2): The line: Scope item 3 lists five echoed fields. The line also carries `number`, `reason`, `landedInTrain`, `trainUnproven`, `trainUnread`, `train` and `trainMergeCommit`, and `mergeCommit` is flattened to its oid string, not gh's `{oid}`. The gh field list adds `labels`, without which the train claim cannot be seen; a missing `labels` key is `missing-field`. `unmeasured` carries a closed set of reasons: `no-remote`, `timeout`, `unreadable`, `missing-field`, `train-unproven` and `train-unread`, and, for any other failed gh call that is not the absent shape, the word of `_gh_fail_reason`, `_gh_pr_list`'s stderr classification lifted into one helper both callers use (`unauthenticated`, `rate-limit`, `offline`, `unavailable`, `truncated`, `error`). So the form narrows no distinction that classifier keeps, and 5h's backoff can act on `rate-limit`. Its heads and merge commits are 40 hex, never `_pr_py`'s 7-to-40 `OID`, so ccd and the reader agree on a well-formed line. The reader (Task 2's Interfaces, `readPrStatePrLine`) reads exactly these keys and passes ccd's reason through; it is stricter than the scope ruling's "a malformed line is unmeasured" and fails closed, and its unmeasured carries `by: 'ccd' | 'reader'`, because a fleet retry and build skew have different remedies and folding them would be the overloaded null CLAUDE.md forbids.
- **D-7595** — `the-forms-train-proof` (Task 1): the form's train proof, one entry. (a) The workspace form reaches the proof through `_pr_train_proofs`, which selects candidates with `_pr_py train-cands <branch> <base>` and binds each to the workspace's branch. Entering through `_pr_train_proofs` would put GitHub's `headRefName` in `train-cands`' argv, a second GitHub-sourced string to anchor (the PR-lifecycle spec's argv rule), for a binding the form does not need, so it enters one level lower, at `_ws_train_record`, the entry the bounded prover `cmd_pr_train_prove` uses, and hands the answer to python through the same `_PR_TRAIN_PROOFS` / `_PR_TRAIN_REFUSED` line formats. The verdict comes from the one `train_flags(r)` judge, moved out of `annotate`. No second prover is written. The form keeps the fork conjunct: `by-pr-cand` requires `isCrossRepository is False`, as `train-cands` does, so a fork PR is never proved and reads `unmeasured`/`train-unread`. `train-proof.sh`'s budget-table sentence and `_pr_train_proofs`'s header are reworded so neither still says every proof enters there. (b) The proof is keyed and checked by base, and here the base can only come from GitHub's own `baseRefName`. The PR-lifecycle spec (`2026-07-29-ccrc-pr-lifecycle-design.md`) says "No GitHub-sourced string is ever placed in a prompt, an argv, or a shell", and on main only digits and hex leave `_pr_py` for an argv. This form departs from it: a GitHub-sourced base name, anchored to `_ws_train_keyable`'s grammar (no backslash, space or leading dash, so `awk -v` escape processing cannot alter it), reaches python3's and awk's argv (`_pr_py train-check`, the kept-proof and tried-line reads); it never reaches gh or a shell. `by-pr-cand` checks it against `[A-Za-z0-9._/-]+` with no leading dash, and `_ws_train_keyable` checks it again before writing. The precedent is the landing verdict's anchoring of a base name to `[A-Za-z0-9._/-]` (wave 3e, D-6337). Consumer 5h must still conjoin `baseRefName` with its entry's own base. (c) the form calls `_ws_train_record` with keep=1, as `pr-state --session` does, so it writes `$REG/.train-proofs` and `$REG/.train-tried`, and a repeated poll of a train-landed PR costs one gh call instead of three.
- **D-7596** — `refused-claim-reads-unmeasured` (Task 1): This follows scope item 4's literal text. It departs from the workspace form and from the README's existing train paragraph, where a claim whose record was read and failed (`trainUnproven`) reads `closed`. The PR-keyed form reads the same fact as `unmeasured` with reason `train-unproven`, so one PR can read `closed` on `pr-state --session` and `unmeasured` on `pr-state --pr`. The new README paragraph says so. 5h must not treat the two forms' words as interchangeable.
- **D-7597** — `wave-3d-f1-f6-text` (Task 3): wave 3d's F1 and F6 text is reworded beyond the literal phrase. Scope F1 names one phrase, "at or one second before". At two of the five sites, the ccd queue-block header and the spec section 5.2 amendment, the same sentence goes on with a consequence that is false for the same measured merge (D-6216): "so the add is never the last act of a landed PR" and "so the add is never a landed PR's last act". In the second after the merge, the PR reads MERGED and its last act is still the add. The task rewords that clause as well ("a landed PR's last act is that removal or, until the removal is recorded, the add") and updates the stale count "16 of 16 queue merges" to D-6216's "22 of 22" at the ccd and test-comment sites. The README site reads "at or a second before", so a literal grep for the scope's phrase misses it; it is reworded anyway. The `PR_QUEUE_MAP` doc comment in `server/src/prstate.ts` does not contain the false claim (its `landed` gloss, "for the second before GitHub reads the PR merged", is still true); it gains the "within a second of the merge, either side (D-6216)" sentence so the five sites agree. F6 is restated in place (the last act of either kind is read so that a re-enqueued PR reads as queued again; since wave 3d the removal's reason tells a queue landing from a hand merge) and a dated "Restated 2026-10-30, wave 5c" note after the wave 3d amendment records what the bullet and the amendment said before, paraphrased so the retired phrase does not return. The F1 and F6 rewordings ship with no test that pins the prose: a text test over README, the spec or `server/src/prstate.ts` would make its suite a reader of source as text, which fast CI leaves to the merge queue. Step 9's grep is the check instead, and the mutation table covers only the new guards (paging, and F7's rows).
- **D-7598** — `rules-read-is-paged` (Task 3): the landing-rules read is paged. Review 1109 allows either paging the read or treating a full page as unmeasured; the plan pages it (`--paginate`, every page parsed, any non-list or non-JSON page making `rules` unmeasured and uncached), which is the probe's own fix-round-1 precedent. Every page is read under the existing single `PR_LANDING_REST_TIMEOUT` (4 s), with no new timeout, so pr-landing's 6 + 4 + 4 s budget pin is unchanged; a slow multi-page read that times out answers `rules` unmeasured for that pass, which fails closed. The multi-value reader `docs(fd)` in `_pr_landing_py` sits beside `ccd-land-probe`'s `json_values`; the legitimately different reason is another file and process, since a heredoc program inside `ccd/ccd` cannot import the probe's Python module. Inside `ccd/ccd` it consolidates rather than adds: `doc(fd)` now derives from `docs(fd)` (exactly one value, else None) and `docs` catches `Exception` as the old `doc` did, so the heredoc has one JSON reader and the move is behaviour-preserving for the `rows` and `names-protection` modes, covered by the existing ccd-pr-landing cases.
- **D-7599** — `pr-state-pr-form-growth` (Tasks 1 and 3): `ccd/ccd` is growth-listed, and this wave grows it past the limit: the form's helper, its two python modes, the `train_flags` and `train_cand` move, the `_gh_fail_reason` lift, and Task 3's paged reader. The waiver `server/test/growth-waivers/D-7599-pr-state-pr-form.json` is written in Task 1, with the delta measured then, if `ccd/ccd`'s net delta already exceeds 40; otherwise Task 3 creates it once the PR passes 40. Either way Task 3 sets its `maxDelta` to the whole PR's measured net delta, and Task 4 reports the final figure. The form has to live in `ccd/ccd`, because a `ccd` verb's argv grammar and its `_pr_py` modes are defined there, and no other file can hold them. Everything the server side adds goes in files that are not growth-listed.
