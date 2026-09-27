# ws-add slug picker — a slug is free only when the registry, git and the disk all agree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ccd ws-add` never picks, and never accepts, a slug whose `ws/<slug>` branch or worktree path already exists in git or on disk. It refuses such a slug before anything is minted, and names what holds it.

**Architecture:** one new ccd helper judges a slug against git and the disk, with three answers. `_ws_slug_new`'s random loop and `cmd_ws_add`'s named-slug check both call it, beside the registry check they already make. It is placed below the frozen citation corpus's highest `ccd/ccd` anchor, and every edit above that anchor is made in place, so the frozen corpus never moves. No server, wire or capability change.

**Tech Stack:** bash (`ccd/ccd`), vitest (`server/test`).

**Programme ledger:** `docs/superpowers/programs/ws-slug-collision.md` (on the coordinator's branch). One wave.

---

## The defect, measured 2026-09-23

- `POST /api/runs/136/dispatch` answered a bare 502:
  `{"ok":false,"stderr":"fatal: a branch named 'ws/quiet-delta' already exists\nccd: git worktree add failed for …/quiet-delta\n"}`.
- `_ws_slug_new` draws adjective-noun slugs and takes the first one `_ws_slug_free` passes. `_ws_slug_free` globs `$REG/<id>.*` and the dot-leading private families. It never asks git.
- `cmd_ws_add` then runs `git -C "$main" worktree add -b "ws/$slug" --no-track "$wt" "$base"` (with `main=$PROJECTS_ROOT/$project` and `wt=$WORKTREES_ROOT/$project/$slug`), which dies on an existing branch.
- The branch `ws/quiet-delta` dated from 2026-09-17. At the time, 27 of ccrc-pwa's 33 `ws/*` branches had no registry row.
- Nothing had been created: the run was still `planned`, with no worktree and no registry row. The cost was one failed dispatch, and a 502 shape the coordinator skill tells coordinators to stop on.
- A slug the operator names explicitly (`ws-add <project> <slug>`, or `CCD_WS_SLUG`) fails the same way today, with the same late message.

## Global constraints

- **Fixture HOMEs only.** Every test drives ccd through `makeCcdHarness` (`server/test/ccdWsHelpers.ts`). Never run ccd against the live `$HOME`.
- **Three answers, not two.** `git show-ref --verify --quiet refs/heads/ws/<slug>` exits 0 when the ref exists and 1 when it does not; anything else is a failure to read. A failed read is `unmeasurable`. It must never fold into `free`, which would retry into the same late death, and it must never fold into `taken`, which would burn 60 draws and blame the slug.
- **`_ws_slug_free` is not widened.** Its contract ("every reason `_ws_slug_free` can refuse is a reason `_ws_slug_residue` can name") and its other callers (the `ws-gc` unclaimed census) are about the registry only. The git and disk judgement is a separate helper that the two ws-add call sites add beside it.
- **Line budget above the frozen corpus.** First measure the highest `ccd/ccd:<n>` anchor cited by the two frozen corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` and `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`, as `server/test/session-hook.test.ts` reads them). Place the new helper and its comment BELOW that line. Above it, edit existing lines only, with a net line delta of 0, and prove it: `git diff -U0 origin/main -- ccd/ccd` must show no hunk above the boundary with unequal `-`/`+` counts. Long argument goes in the helper's header, below the boundary.
- **Pay S6-R11 in the same task.** `ccd/ccd` is cited. After the last ccd edit, re-stamp ccd, re-point README by content, then re-measure the census. Use the README re-pointer and census re-measurer defined in `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md` (its "Write the README re-pointer" and "Write the census re-measurer" steps, and the procedure that follows them). Report `stated / base / tree` and ENTERED/LEFT verbatim from the instrument; never retype an anchor.
- **Mutation-table discipline.** Every guard ships with a case that reds when the guard is removed. Measure the red, restore, re-stamp.

## Task 1 — `_ws_slug_git_state` and its two call sites

**Files:** `ccd/ccd`; tests in `server/test/ccd-workspaces.test.ts`, or a new `server/test/ccd-ws-slug-git.test.ts` that passes `ccd-workspaces`' containment scan.

The helper: `_ws_slug_git_state project slug`. It prints exactly one line and returns:

| rc | stdout | when |
|---|---|---|
| 0 | `free` | no `refs/heads/ws/<slug>` in `$main`, nothing (not even a dangling link) at `$wt`, and `$wt` is not a registered worktree of `$main` |
| 1 | `taken <what>` | `<what>` is `branch ws/<slug>`, `path <wt>`, or `worktree <wt>` (registered in `git worktree list --porcelain` though its directory may be gone); the first one found |
| 2 | `unmeasurable <why>` | `$main` is not a readable repository, or `show-ref`/`worktree list` failed for a reason other than ref absence |

Wiring (both edits in place, above the boundary):
- **`_ws_slug_new`, random loop.** A draw is accepted only when `_ws_slug_free` passes AND the git state is rc 0. On rc 2, stop drawing at once: say the `unmeasurable` line on stderr as `ccd: …` and return 1, so the caller's existing `die "could not find a free slug for $project"` fires with the cause printed just above it.
- **`_ws_slug_new`, `CCD_WS_SLUG` arm.** The same check, refused the same way.
- **`cmd_ws_add`, named slug.** Where `_ws_slug_free … || die "slug in use: $slug — in $REG: …"` stands, the refusal also fires on git state rc 1 or 2, and its message names what was found: the registry residue, or `branch ws/<slug>` / `path …` / `worktree …`, or the `unmeasurable` cause. It still refuses before the fetch and before `git worktree add`, with the ws-add lock released by the existing `die` path.

Steps:
- [ ] Measure the frozen boundary and write it down in your report.
- [ ] RED: a named slug whose `ws/<slug>` branch exists in the fixture repo is refused. The message names `branch ws/<slug>`, and afterwards there is no registry row, no worktree directory and no new branch commit.
- [ ] RED: the same for an existing non-empty directory at `$wt` (`path`), and for a registered-but-missing worktree (`worktree`).
- [ ] RED: the random picker skips a slug whose branch exists. Make it deterministic without adding a production-only test knob. For example, pre-create `ws/<slug>` branches for every draw but one in a fixture whose word lists you can bound through existing means, or drive `_ws_slug_new` directly from a sourced copy the way other `ccd-*` tests drive internal functions. If no honest deterministic form exists, stop and report; do not add an env knob to production code.
- [ ] RED: unmeasurable. Make `$main` unreadable as a repository, and the refusal names the `unmeasurable` cause, not "slug in use" and not a slug.
- [ ] GREEN: implement the helper below the boundary, then the in-place wiring above it.
- [ ] Mutation rows, each measured red, then restored and re-stamped:
  1. delete the git check from the random loop;
  2. delete it from the `CCD_WS_SLUG` arm;
  3. delete it from the named-slug refusal;
  4. fold rc 2 into rc 0 inside the helper;
  5. fold rc 2 into rc 1 inside the helper.
- [ ] Re-stamp ccd, then pay S6-R11 (above).
- [ ] Every existing ws-add test stays green: a free slug behaves exactly as before.

## Task 2 — verification and PR

- [ ] `git fetch origin main`. If `main` moved `ccd/ccd` or README, merge it (never rebase), then re-point and re-measure.
- [ ] pwa: `npm ci && npm run test` (first, because server's typecheck-tests needs its modules). agent: `npm ci && npm run test`. server: `npm ci`, then `./node_modules/.bin/vitest run --shard=K/12` for K = 1..12. All in the foreground, each call with a timeout of at least 600000 ms. A red is re-run alone, then run on an untouched `git archive` of the base, before it is called this wave's. (`tmp-sweep.test.ts`'s "FAILS CLOSED" case is red on this box on untouched main.)
- [ ] deviation-refs, dtbd and topology-clean.
- [ ] Open the PR against `main` from this workspace's own branch. Its body carries the defect, the fix, the frozen-boundary measurement, the S6-R11 numbers and the mutation table. Do not merge. Do not deploy.

## Deviations found

Numbers are ISSUED, never chosen. This programme's block was allocated once by its coordinator at run-open, and a worker never calls the allocator. A departure found while executing this plan is named in the wave-done mail: what departed, where, and why. The coordinator assigns its number and has it defined here.

- **D-3473** — README.md edited under a held claim (Task 1, S6-R11). `README.md` was claimed by another programme (run 128). The worker mailed the holder its narrow scope, two `ccd/ccd` anchor numbers re-pointed by content (`21079` → `21202`, `19866-19868` → `19989-19991` at fix round 2's tip — +123, the helper's growth below the boundary), and committed the re-point without an answer, because without it the session-hook README case reds. The coordinator accepted it: claims are advisory, and the other programme's coordinator agreed that the second PR to merge re-points README and re-measures.
- **D-3474** — two existing `_ws_slug_new` unit tests plant a repository (`server/test/ccd-workspaces.test.ts`, "generates a slug that is itself valid" and "honours CCD_WS_SLUG when the name is free"). They called `_ws_slug_new` with no repo, which this plan's table now answers `unmeasurable`. They plant `makeRepo('demo')` in a line-neutral edit, because the frozen corpus cites that file at lines 121–272. The same file gains one DISPOSITION entry for the new file's three `slug in use:` assertions. Fix round 2 (review 141, F1) plants the same repository, line-neutral, in the three other `_ws_slug_new` cases there ("never collides with an existing registry entry", "rejects an invalid CCD_WS_SLUG rather than passing it through", "keeps the generator off a residue slug as well as the explicit one"). Without it they passed for the wrong reason, because the missing repository answered `unmeasurable` before the registry and validity checks they pin could decide.
- **D-3475** — `_ws_slug_git_state` also proves git's resolved toplevel is `$main` (Task 1). git skips a `.git` it cannot read and keeps discovering upwards. Measured: a broken `$main` inside another repository answered `show-ref` from the outer one (rc 1, which reads as `free`). So a toplevel that is not `$main` is `unmeasurable`. It has its own test and mutation row 6.
- **D-3476** — the probes tell unreadable from absent and see directory/file conflicts; the plan's show-ref-rc premise was false (fix round 2, review 141 F2–F4, `_ws_slug_git_state` below the frozen boundary). The Global Constraints said `git show-ref --verify --quiet` exits 1 only when the ref is absent. Measured on git 2.43, it also exits 1 for:
  - a loose ref git cannot read (mode 000), and a corrupt one;
  - anything under an unsearchable `refs/heads` or `refs/heads/ws`;
  - a `ws/<slug>/<x>` branch, and a branch named just `ws`.
  `git worktree add -b ws/<slug>` dies on every one of these. So after rc 1 the helper also runs these probes:
  - `show-ref` on `refs/heads/ws`;
  - `for-each-ref` under `refs/heads/ws/<slug>/`, which sees packed children;
  - the loose paths under `--git-common-dir`. An unsearchable directory is `unmeasurable`. A file at `refs/heads/ws` is `taken branch ws`. A directory at the ref path is `taken`. Anything else standing at the ref path is `unmeasurable`.
  When `$wt` does not stat and a directory above it is unsearchable, the path probe answers `unmeasurable` rather than `free` (F4). Measured, and kept by ruling: git removes an EMPTY directory at the ref path and succeeds, so `taken` there is stricter than git. Each new arm has its own test and mutation row (13–20 in PR #177's table).

---

## Review lenses

The held-out panel (three Opus·high lenses, three Sonnet·high refuters per finding) reads this wave. It is asked to hold:
- the three answers apart;
- the frozen corpus unmoved;
- the named-slug refusal ahead of every mint;
- the free-slug path byte-identical in behaviour.
