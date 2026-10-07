# Program: native-docs-reader

Spec: `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (approved 2026-10-01)
Plans: W1 `docs/superpowers/plans/2026-10-01-native-docs-reader-w1-ccd-reads-docs.md`; W2 `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-canyon`   Workspace: a fresh child per wave

**What this program is.** ccrc gains its own session-gated Docs reader for each install's own project docs:
specs, plans, product-design and conventions. It replaces the operator's standalone, tailnet-only docs server
with nothing outside ccrc's auth. The content stays in each user's own repositories and is never bundled.
The fleet box reads docs through four narrow ccd verbs (W1). The server adapts them behind a capability
(W2) and serves session-gated routes (W3). The PWA renders docs, images and sandboxed mockups (W4-W6). W7
documents and releases it.

## Waves

The spec (§7.7) orders them W1 -> W2 -> W3 -> W5 -> W6 -> W7, with W1 -> W4 -> W5 in parallel.

| # | scope | PRs | state |
|---|---|---|---|
| 1 | ccd reads docs: `shared/docs.ts`, `docs-index`/`docs-tree`/`docs-show`/`docs-fetch` and the embedded helper, the doctor's `docs` check | #301 | **merged** 2026-10-06 (`f03d83304`). Executed in the coordinator's session (subagent-driven, 19 tasks, per-task reviews, a six-lens final review, one fix round), not as a run |
| 2 | grants and adapter: agent grants, `DOCS_CAP` and builders, runner budgets, `server/src/docs/{policy,ports,ccdsource}.ts`, the docs ring guard | — | plan written 2026-10-06; dispatch after this ledger PR merges and the operator approves the plan |
| 3 | routes: `server/src/docs/{routes,hooks,lane,cache}.ts`, registration, dark rollout, R1/R2 | — | after W2 |
| 4 | PWA foundation: markdown extraction, `RenderBoundary`, chat hardening (U3), `docs-sw` | — | parallel-eligible now. Its doctor-file edit waits on the holder of that file's claim |
| 5 | Docs screen, plus Share and Export (see Decisions, 2026-10-06) | — | after W3 and W4 |
| 6 | mockups | — | after W5 |
| 7 | docs and release | — | after W6 |

## Decisions & deviations

- **2026-10-01: spec approved**, with rulings U1-U5:
  - U1: a 2 MiB image cap.
  - U2: a per-view "Load external" tap for mockups.
  - U3: chat hardening, option (b).
  - U4: a required headless-browser CI leg.
  - U5: the pre-existing route defect is reported privately first, then fixed in its own PR after W3.
- **2026-10-04 to 06: W1.** Its departures are D-4150 to D-4164, issued by the allocator and defined in the W1 plan's Deviations section. The ones a later wave consumes:
  - **D-4157:** `docs-index` stops at its deadline and counts the projects it did not reach in an additive `unwalked?`. W2's adapter passes it through, and W5 renders "N not checked".
  - **D-4158:** `ref-locked` requires git's lock-file evidence.
  - **D-4159:** rc 0 beats the time bound.
  - **D-4163:** `--refmap=` and `followRemoteHEAD=never` on fetch.
  - **D-4164:** the draft phase degrades and never fails the tree.
- **2026-10-06: W1 on CI's git 2.55.** Three test assumptions held only on git 2.43:
  - the host's system filter config produces the `filters-bypassed` caveat;
  - a lazy-fetch-blocked `cat-file --batch-check` answers `<oid> missing` at rc 0;
  - the directory/file ref-conflict stderr wording changed.

  The tests are now version-tolerant, measured under 2.43 and 2.55, with no product change.
- **2026-10-06: W2 plan.** Its header lists refinements (a) to (s). Refinements (c), (d), (f) and (g) contradict the spec's text. They are defined as deviations in W2's Task 6 with the first four numbers of the block this coordinator issues at run-open.
- **2026-10-06: sharing (operator).** Fold a Share action and a self-contained Export into W5/W6. Share is the native share sheet or copy-link, carrying the GitHub permalink at the served commit. Export is a single HTML file with inlined images and scripts off. Expiring share links come later, as their own designed wave with a threat model. The design is being settled; the spec amendment follows.
- **2026-10-06: plan format.** Plans in this programme stay Markdown: `deviation-refs` and the ledger floor read `*.md` only, and the SDD task extraction reads Markdown headings. This awaits the operator's confirmation against the global HTML preference dated 2026-10-06.

## Carried constraints (reviewers get these)

- **SEC-3:** a helper killed from outside leaves git's process group running. W2 pins the budget invariant, so ccd is never killed in normal operation. The real fix is unscheduled.
- **SEC-4:** fetch stamps accumulate, one per distinct branch name (W5 housekeeping).
- **No stamp after a failed post-fetch for-each-ref** (W5).
- **`branch: null`** covers both a detached HEAD and an unmeasured read (W2 adapter and W5 rendering).
- **`GithubTarget` cannot express `resolveDocRef`'s `repo` kind** (W3/W4, with its consumer).
- **A commit missing from a partial clone** answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on 2.55. W2 carries it in its results and does not close it.
- **Over-cap `too-many-entries`** reports `bytes` measured on a stripped body.
- **W7 prose residue:**
  - stale `ccrc-doctor-checks` citations in `ccd/ccrc` that predate W1;
  - `deploy/account-op.mjs:586` cites `:166`, which W1 moved to `:173`;
  - spec §7.2's two python3 / placement sentences;
  - the lockAgeMs prose in the spec;
  - docs-shared's claim about two refinements;
  - the dropped clause "git 2.43 ignores the key".
- **U5:** the private vulnerability report is not filed yet. The spec's one-line mention is public since #301.

## Next-wave brief (W2)

- **Plan:** `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`, Tasks 1-9.
- **Base:** `main` containing W1's `f03d83304`. The plan's numbers were measured at W1's tip, so counts that include pre-existing tests may differ. What binds is the new cases behaving as written.
- **Execution skill:** `superpowers:subagent-driven-development`. Routing (matrix row "worker executing a spec'd plan"): Opus·high main loop, Sonnet·high implementers, an Opus·high per-task reviewer, workflows off, `compact 40`.
- **Branch discipline:** commit on this workspace's own branch, never a separate feature branch.
- **Deviation block:** the four numbers Task 6 defines, plus a reserve, issued at run-open and named in the brief.
- **Review:** after the verified wave-done, a review run with the held-out panel (`review-panel.md`). Lenses: rings, version skew (git 2.43 vs 2.55), untrusted input, mutation discipline, spec conformance.
- **Carried constraints:** the list above, verbatim.
