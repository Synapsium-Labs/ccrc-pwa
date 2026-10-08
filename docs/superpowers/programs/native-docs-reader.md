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
| 2 | grants and adapter: agent grants, `DOCS_CAP` and builders, runner budgets, `server/src/docs/{policy,ports,ccdsource}.ts`, the docs ring guard | #319 | run 315, dispatched 2026-10-07 10:39 UTC. Wave-done at `03826657e`. Review 317 found two defects, fixed in fix round 1, which reported done at `2190cc43f`. Scoped re-review 336 closed both, and found the new scan too narrow in three places and too wide for W3's own code. Fix round 2 (`4017e8262`) closed those; scoped re-review 337 found five more items in the same scan. Fix round 3, the last on this scan, was sent 2026-10-08 09:10 UTC. A closure check follows, then the merge |
| 3 | routes: `server/src/docs/{routes,hooks,lane,cache}.ts`, registration, dark rollout, R1/R2 | — | plan written 2026-10-08 (`docs/superpowers/plans/2026-10-07-native-docs-reader-w3-routes.md`, 12 tasks, six deviations), awaiting the operator's review. Dispatch after W2 merges |
| 4 | PWA foundation: markdown extraction, `RenderBoundary`, chat hardening (U3), `docs-sw` | — | parallel-eligible now. Its `ccd/ccrc-doctor-checks` edit waits on whichever claim holds that file (claim 1072, run 302, on 2026-10-07) |
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
- **2026-10-07: drafts in Share and Export (operator), option (b).** In a view with drafts, Export may include them under a visible "Draft, not committed" banner naming the base commit. Share always sends the committed permalink, with a warning that drafts are not included.
- **2026-10-07: U5 (operator).** Draft the private report for the pre-existing route defect. The draft stays outside tracked text until the fix ships.
- **2026-10-07: plan format (operator).** Plans stay Markdown, in this programme and every other. The HTML preference of 2026-10-06 is for specs, whose architecture decisions and diagrams engineers approve. An amendment to this programme's existing `.md` spec stays Markdown.
- **2026-10-07: W2 approved and opened.** The operator approved the W2 plan, and #306 merged it with this ledger (`a17e14bc0`). Run 315 opened for wave 2/7, with no `sessionId`, so a fresh child is minted. The allocator issued numbers **4374 to 4387** for it. They are written bare here until a plan defines them, because the floor guard reds any `D-` token above the highest defined number:
  - Task 6 Step 6 defines 4374 (refinement c), 4375 (d), 4376 (f) and 4377 (g).
  - 4378 to 4387 serve departures found while executing and in fix rounds. The worker takes them in order and lists each in its wave-done. A departure that changes behaviour the spec states goes to the coordinator as a question first.
- **2026-10-07: R1 (coordinator).** The W2 worker pushes its branch and opens the wave's one PR after Task 9, replacing the plan's "No task pushes or opens a PR" and "Push, PR and merge are the coordinator's". CI runs git 2.55 and the fleet box 2.43, and W1 met three version differences only in CI, so CI must run while the review reads. The merge stays the coordinator's, after the review.
- **2026-10-07: W2 drift, measured.** Applying the plan's whole prototype diff to `main` at `a17e14bc0` moved exactly two Find blocks; every other hunk applies, some at offsets of up to 13 lines:
  - `verb-gate.test.ts`'s `CAP_GATED_VERBS` gained `'ws-expire'` (#312). The set becomes the plan's set plus `'ws-expire'`.
  - `single-definition.test.ts`'s tail grew (#312, #299). Task 8 appends after the real last line.

  The brief rules both as mechanical re-anchors.
- **2026-10-07: claim overlap with run 302.** Claim 1073 (programme `ccrc-history`, wave 2 B1) holds `server/test/single-definition.test.ts` and `server/test/lifecycle.test.ts`. B1 only appends at the end of both; W2 appends at the end of both and edits one line in place in each (the archive door pin's `want` line, and the `../src/lifecycle.js` import). The coordinator proposed a scoped agreement to run 302's coordinator in mail 3812: each side edits only its own lines, and the second to merge takes `main` and keeps both blocks. Run 302's coordinator was busy, so W2 was dispatched before the reply. Task 1 edits neither file. Before Task 2 the worker claims the two files again, and edits them only once claim 1073 has ended or the coordinator has confirmed the agreement by mail.
- **2026-10-07 11:21 UTC: claim ruling (operator).** W2 edits the two files under claim 1073 within the proposed scope, without waiting for run 302's coordinator. W2's worker was told by mail. So were the claim's holder (the protocol's address, named by the claim's own `mailHint`) and its coordinator.
- **2026-10-07: W2's `sd-shape` invariant (coordinator).** Task 9's checker compares each commit with its parent, and two review fixes inserted lines inside W2's own appended block. Measured net against the base, `single-definition.test.ts` changes by exactly the in-place `want` line plus one end-of-file block, and the citation census is green. The FAIL is recorded as it stands, without a re-run or a checker edit. The wave-done keeps `suite: unrun`. This is not a deviation.
- **2026-10-07: W2's held-out review (run 317, tip `03826657e`).** 8 lenses, all returned. 18 findings raised, 2 survived the refute pass, 0 unexamined. Every Task 9 suite reproduced, and all 161 mutation rows red as recorded.
  - **F1, important: fixed.** Check 8 coerced a non-string `onRef`. An array passed as ok, and a throwing `toString` rejected the port's promise.
  - **F2, minor: fixed now.** Refinement (g)'s single reader of `killed` and `signal` had no scan that went red on a second reader.
  - **Settled by the review:** check 3's half-measured shape is covered by W2's deviation 4377. The second redaction pass's depth bound (4378) is beyond every failure body W1's helper emits. Thirty-two guards have no mutation row, but each went red when the reviewer mutated it, so coverage is complete.
  - **Deviations defined in W2's plan on its branch:** 4374 to 4378, written bare here until W2 merges.
- **2026-10-07: W2 fix round 1.** Commits `52a884b01`, `64ebe8351` and `2190cc43f`. 163 rows measured as expected. No new deviation.
- **2026-10-08: W2's scoped re-review (run 336, tip `2190cc43f`).** Five lenses, all returned. 23 findings raised, 17 survived, 0 unexamined. Both of review 317's findings are closed. Every suite, all 163 rows and the claim scope reproduced.
  - **F1, important: fix now.** The one-reader scan blanks comments and strings, but it has no template or regex state. A `/*` inside either literal hides a second reader on a later line.
  - **F2, minor: fix now.** Ordinary spellings evade the receiver match: an element access, a `!` after `)` or `]`, and a member chain split across lines.
  - **F3, minor: fix now.** An arrow-form `ccdEnding` scopes its body past its own end.
  - **F4, cosmetic: fix now.** One results note still says 161 rows.
  - **F5: accepted.** One re-anchored row's plan fence keeps its pre-fix text, as four earlier rows already do.
  - **Scope (coordinator, from W3): fix now.** W3's `lane.ts` reads AbortSignals (`w.signal`, `controller.signal`), and the scan reds every `.signal` read. A `.signal` read now counts only in a file that imports `lifecycle.ts`, and that set of importers is pinned. `.killed` stays checked everywhere. W3 then needs no edit to W2's scan.
  - **Also accepted:** the scan's two allowances beyond `ccdEnding`: the four `ExecResult` reads in `ccd()` and the one bound `ending.signal`. A type-aware scan was considered and not chosen, because the installed TypeScript 7 exposes only an `unstable/*` JS API.
  - **No new deviation:** each fix brings the scan into line with refinement (g)'s wording, "a read on a CcdResult".
- **2026-10-08: W2's second scoped re-review (run 337, tip `4017e8262`).** Six lenses, all returned. 24 findings raised, 17 survived, 0 unexamined. Every fix-round 2 item is closed. W3's four planned files pass the scan unedited, and an AST census found no code that the scan's blanker hides, in today's tree or in W3's files.
  - **F1, important: fix.** The rule that decides where a regex starts has an operator arm and a keyword list with no mutation row. Deleting the operator arm hides a reader behind `(s) => /x'y/`.
  - **F2, minor: fix three of four.** Importer detection on blanked text, the bare-import arm and the specifier anchor each get a row. The broken-chain tail's `!?` changes only the printed receiver, so it is accepted.
  - **F3, minor: widen three, name the rest.** A chain broken after the dot, a repeated `!`, and an import after another statement on its line are caught. Import-equals, subdirectories, re-exported types and exotic spellings are named as known evasions.
  - **F4, minor: fix.** A backslash-newline inside a string shifted later line numbers.
  - **F5, minor: fix.** The scope CONTROL is rebuilt from the W3-shaped file itself.
- **2026-10-08: the scan's evasion list is not exhaustive (coordinator).** Fix round 2 asked that list to name "exactly what still evades". A text scan cannot meet that, and each review found new spellings. The list is now "known evasions". Fix round 3 is the last on this scan. Its review checks the round's items, and any new evasion spelling becomes residue for a later wave, unless it hides a reader through a spelling already in the tree or in W3's files.
- **2026-10-08: W3 plan.** Written by a planning workflow: scouts, an architect, one writer per task prototyping on a scratch tree at W2's tip, a plan review and two fix passes.
  - **12 tasks.** Task 11 is the whole-branch review, run before Task 12's close. Task 12 pushes and opens the PR.
  - **Six departures from the spec's text,** defined by Task 9 Step 7 with the first six numbers of W3's block:
    - (d) router-level 414/400 refusals;
    - (i) the composition built in `buildServer`, with no `index.ts` edit;
    - (j) abandonment measured on the response's close;
    - (s) the latency test on a bare Fastify;
    - (v) the fetch lane's own FIFO instead of a second `KeyedQueue`;
    - (w) a JSON file reply serving the bytes check 8 verified.
  - **Why (w) counts (coordinator, 2026-10-08):** §3.5 says "wraps these answers unchanged", and the served field differs for an answer outside ccd's contract.
  - **What W3 settles:** every item W2's reviews carried to W3, and review 317's notes.
- **2026-10-07/08: two coordinator lessons.**
  - A long workflow keeps this session "busy" to the mail gate. Review 317's report sat queued for nine hours, so check mail on every wake.
  - `mail list --to <id>` lists only outstanding mail. A send that timed out and was later acked looked unsent, and was sent twice. Verify a send through the feed or `--all`.

## Carried constraints (reviewers get these)

- **W3's accepted residue, from its plan:**
  - The fetch lane's generation map grows by one short entry per distinct project refreshed. It is session-gated and cannot be pruned safely.
  - `policy.ts`'s `lowerAscii` duplicates a private L0 helper. It is pinned by a parity case and goes to W7.
  - The second redaction pass rewrites values, not key names. This is latent, and the fix belongs to L3.
  - The `JSON.parse` cost inside `ccdsource.ts` is deferred.
- **W2's parked minors** are in its SDD ledger, and none blocks W3.

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
  - README's doctor table has no row for W1's `docs` check, and its server-role SKIP sentence (the D-3111 list ending "`timeout` and `model-default`") does not name `docs`, although `_check_docs` SKIPs on a `CCRC_ROLE=server` box (reported by another session in mail 3818, 2026-10-07; README is under another programme's claim, so W7 places it).
- **U5:** the private vulnerability report is not filed yet. The spec's one-line mention is public since #301.

## Next-wave brief (W2), as dispatched to run 315

The bullets below were the plan. The brief as sent adds R1, the measured drift, the claim gate and the issued block (Decisions, 2026-10-07). W3's brief is written once W2 is accepted.


- **Plan:** `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`, Tasks 1-9.
- **Base:** `main` containing W1's `f03d83304`. The plan's numbers were measured at W1's tip, so counts that include pre-existing tests may differ. What binds is the new cases behaving as written.
- **Execution skill:** `superpowers:subagent-driven-development`. Routing (matrix row "worker executing a spec'd plan"): Opus·high main loop, Sonnet·high implementers, an Opus·high per-task reviewer, workflows off, `compact 40`.
- **Branch discipline:** commit on this workspace's own branch, never a separate feature branch.
- **Deviation block:** the four numbers Task 6 defines, plus a reserve, issued at run-open and named in the brief.
- **Review:** after the verified wave-done, a review run with the held-out panel (`review-panel.md`). Lenses: rings, version skew (git 2.43 vs 2.55), untrusted input, mutation discipline, spec conformance.
- **Carried constraints:** the list above, verbatim.
