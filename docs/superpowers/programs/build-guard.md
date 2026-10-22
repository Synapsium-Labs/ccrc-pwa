# Program: build-guard

Spec: `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` §7.6 and invariant 11   Plan: `docs/superpowers/plans/2026-10-20-build-guard-878-follow-up.md` (lands with the wave's PR)   Workspace: a fresh child (one PR)
Home project: `ccrc-pwa`   Coordinator: the ccrc-history programme's coordinator, by the operator's ruling of 2026-10-20
A one-wave follow-up to `claude-binary-lifecycle`'s CB1b (#878).
**Status: landed and retired.** #967 merged on 2026-10-20 as `2e3a0959d`, at `659321646` (run 697), after three
reviews and two fix rounds. The programme has no open run. The fleet gets the arm through the operator's rollout.

**What this program is.** #878 (CB1b of claude-binary-lifecycle, merged as `4deebe5b3`) gave the session hook's deny
arm a `build` class: a child session never installs, updates or selects a Claude Code build. Three security findings
were raised against that arm:
- its match of the Claude Code CLI does not read every form of an install or update command as one;
- it does not read the roster's upstream id, so on a box whose upstream id is not `claude` the hook and the children's
  deny file cover different commands;
- its matching of build-directory paths misses some writers and some spellings of the path.

Four verifiers and two plan checkers confirmed all three and extended them. Children run with permissions bypassed, so
the hook's deny arm is the guard that binds them. This programme closes the gaps in it, in one PR.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | The hook's `build` deny arm, in deny mode only: the CLI arm, build-path writes, the files the launcher, the roll and the guard trust, and the upstream id read from the children's deny file (plan Tasks 1-4); CLAUDE.md's SAFETY bullet on builds and the W1 plan's pointer sentences (Task 5) | #967 | **merged** 2026-10-20 as `2e3a0959d` at `659321646` (run 697; reviews 703, 712 and 715; two fix rounds) |

## Decisions & deviations

- **2026-10-20 — opened.** The operator gave the coordinator #878 and its three findings: "you own it, and you deal
  with them". The follow-up is its own programme, not a wave of claude-binary-lifecycle, whose ledger points here.
- **Shape: deny mode only (the coordinator's ruling).** Class mode, the classifier (`server/src/coord/approvalguard.ts`), the guard corpus and
  the children's deny file stay byte-identical. So class mode stays equal to the classifier over the corpus, and no
  child's recorded deny digest changes: changed bytes would make every live child answer `409 deny-not-engaged` to
  `POST /api/approvals` until it respawns. The PR is fleet-only, and the hook reaches each home through `ccrc
  update`'s install spine.
- **Numbers.** Four were issued for run 697, one per task. Each is defined in the plan's `## Deviations found` by the
  commit that first cites it, and they amend D-5993 and D-5994 by pointer sentences, never by rewriting those entries.
  None is named here until the plan on `main` defines it: a tracked mention of a number not yet defined raises the
  ledger floor (`deviation-refs.test.ts`).
- **How the plan was checked.** The four verifiers probed the findings on `main` in fixture HOMEs. One plan checker
  built Tasks 1-4 into a scratch copy of the hook and drove every pin through it; the other measured which command
  forms the CLI runs as a subcommand. Their corrections are folded into the plan.
- **2026-10-20 — the deny file can no longer make jq fail (ruling 7221, the coordinator's).** The worker's own
  review of the arm's regexes, before the PR opened, found a regression in the branch's Task 4 (`main` never read that
  file): a deny file jq could not read made jq exit with no output, and the hook then allowed the verb, surface and
  build arms. The deny file is one per box, so one child could have opened those arms for every child.
  - The hook now reads the file once itself, with a byte cap, and passes its text to jq as an argument. A missing,
    unreadable, non-regular, symlinked, over-cap or unparsable file leaves the arm as on `main`: the verb, surface and
    build arms still deny, and only the upstream-id arms, which `main` never had, stop matching. One non-regular case
    is not covered: opening it blocks before any read, so it stays a named residual, as the installer already
    accepts.
  - Two mutants show it, each red and then green: going back to letting jq read the file reds on an unreadable file,
    and dropping the cap reds on an over-cap file.
  - Every other finding that showed a claim in the plan or the PR body false is named as a residual, by its class,
    in the plan's entries and in the PR body, and was not fixed in the wave; so are two that a later automated
    security review of the pushed branch found. The cost note is one line in the PR body, and the low items are in
    its Notes for review. Review run 703 decides which residuals must be fixed before merge, and the coordinator rules
    on its report.
- **2026-10-20 — wave-done accepted** at `a2b60a743`, PR #967.
  - The PR run tests the merge with `main` and is green on every check, `single-definition` included.
  - The branch's full run has one Linux red: D-5854's ratchet on `server/src/server.ts`, inherited from the branch's
    base, whose count is over the ceiling where `main`'s is at it. By the coordinator's ruling the branch does not
    merge `main` for it.
  - Review run 703 is briefed and waits on the daily dispatch cap. It verifies that each arm denies what the plan's
    entries say, that nothing a child controls turns the arm off where `main`'s would still deny, and that no
    top-level session is denied anything `main` allows. For each residual it says whether a child's ordinary work
    would plausibly produce it or only a deliberate evasion, and which must be fixed before merge.
- **Review 703 (the wave) ran in the coordinator's session, by the operator's instruction** ("do the review here").
  Review run 703 was briefed but never dispatched while the daily cap held it, so it was closed as abandoned, with no
  fleet act, and the same held-out panel ran in the coordinator's own session: four Opus lenses (one on fail-open
  paths and false positives) and a residual judge, with three Sonnet refuters per finding. It confirmed 28 minor
  findings and refuted 3, and no lens was unverified. The judge sorted the residuals into 26 classes and found none
  that must be fixed before merge. Its first probe batch was stopped by Claude Code's own removal check and was not
  re-issued, so the removal spellings were judged by class, not measured.
- **Fix round 1 (ruling 7313, the coordinator's):** text and tests only, with no regex change and no new number: a
  pin for the deny file's byte cap under a multi-byte locale, a pin for the pair rule's `update` half, the plan's
  entries, CLAUDE.md's residual list and the PR body made to agree, every repetition the wave adds stated as bounded,
  the bare `cd` named as a residual, and the inherited cost route (a very long command that makes jq give up) added
  to the cost line.
- **Review 712 (fix round 1):** 2 minor findings. **Fix round 2 (ruling 7337):** the byte-cap pin now reds through its
  own logic (a valid deny file over the cap in bytes and within it in characters), not through the argument-size
  limit, and the bare-`cd` wording is corrected.
- **Review 715 (fix round 2):** 4 minor findings, none in code or test behaviour; ruled merge without a third round.
  Two were text in the plan's entries, corrected in place by the ledger PR that records this: D-6066's amended
  sentence (a broken join, and a commit citation that named the wrong measurement) and D-6064's bare-`cd` sentence,
  which named only one of the two forms that let an earlier bare `cd` reach later segments (the safe direction:
  more denies). The wave-done's exact padding counts were wrong (the test asserts bounds, which hold), and one green
  measurement was the reviewer's, not in the worker's evidence.
- **2026-10-20 — landed.** #967 merged as `2e3a0959d` at `659321646`; run 697 closed and the programme retired. It
  defines D-6063, D-6064, D-6065 and D-6066, each in the plan.
- **Follow-up candidates (the coordinator's, from the reviews; none is planned):**
  - match a redirection with no space before its target, the cheapest of the named residual classes;
  - anchor the bare `cd` (D-6064's residual);
  - cap a child's command length in deny mode, which closes both the route where jq gives up and the hook timeout;
  - fold `..` in path normalisation.
- **Waiting on the operator** (unchanged on 2026-10-20). The PR body asks both; neither is the PR's to answer.
  1. Top-level sessions. Spec invariant 11 says these acts are "denied to sessions and children", but the routing
     spec's children-only ruling (`2026-10-17-coordinator-first-routing-design.md` §6.6, "Top-level sessions keep
     today's settings") leaves a top-level session undenied. Either the `build` deny extends to top-level sessions, or
     invariant 11 and CLAUDE.md are amended to children only.
  2. Should every rostered wrapper be covered, not only the upstream id? A wrapper whose id does not start with
     `claude` (D-5994's named residual) is not covered today.

## Carried constraints

- **Pre-existing risks, named and not changed by this wave.** The deny arm fails open whenever jq fails or the hook
  times out. So every repetition the wave adds is bounded, each segment-scanning arm first passes one whole-command
  test of its anchor, and the plan pins the time on long inputs.
- **Accepted false denies** are in the safe direction; the plan's Review Focus lists them and the PR body names them.
- **Public repository.** Neutral names only (`upstream-a`, `lane-a`, `/home/u`); no lane, account, host or project
  names.
- **Fixture HOMEs only.** Never run claude, an installer, `ccd` or the hook against the live HOME, and never fetch an
  installer.
- **Lines another PR owns.** #722, the public-tree scrub, rewrites one line of the deny test and four comment lines of
  the hook. The wave edits none of them. #722 landed first, on 2026-10-20. The coordinator measured the branch's merge
  with `main` at `780c8126c`, and with #722's branch, as clean.
- **No line citations** in code or test comments (`citations.test.ts`): cite symbols.

## Next-wave brief

Wave 1 was dispatched on 2026-10-20 as run 697. Its brief named the plan (committed unchanged as the branch's first
commit), the verifiers' and checkers' evidence, the claims it edits under, the four numbers, the gates and the PR's
title. It landed as #967. No second wave is planned: the follow-up candidates above, or an operator answer to either
question above that widens the deny, would open one, with its own plan. The rollout of #967 is the operator's.
