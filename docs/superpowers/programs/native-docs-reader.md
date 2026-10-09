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
| 2 | grants and adapter: agent grants, `DOCS_CAP` and builders, runner budgets, `server/src/docs/{policy,ports,ccdsource}.ts`, the docs ring guard | #319 | **merged** 2026-10-09 (`5a6e5d3d7`). Run 315: review 317, then three fix rounds (two defects, then the one-reader scan), a merge of `main` after ccrc-history B1 landed, and closure review 343. Run 315 closed done |
| 3 | routes: `server/src/docs/{routes,hooks,lane,cache}.ts`, registration, dark rollout, R1/R2 | #339 | **merged** 2026-10-09 (`f4d75a741`). Run 342: review 361, one fix round, scoped re-review 364 clean. After the merge, the operator runs the dark rollout, fleet first, then R2 and R1 (§7.8). Both gate W5's merge |
| 4 | PWA foundation: markdown extraction, `RenderBoundary`, chat hardening (U3), `docs-sw` | — | plan written 2026-10-09 (`docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`, 12 tasks, four deviations), awaiting the operator's review. Run 367 opened 2026-10-09 with block 4768 to 4783 |
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
- **2026-10-09: W2 lands second after ccrc-history B1.** #315 merged first, as agreed. #319 then conflicted only at the end of `single-definition.test.ts`. The worker merged `main`, kept B1's text where `main` has it, and put W2's block last.
- **2026-10-09: W2's closure review (run 343, tip `0acbfadea`).** Every item ruled in fix round 3 is closed. The merge is clean. All suites pass, and all 189 mutation rows are red as recorded.
  - Four minor findings, carried as residue, not fixed. Two rules in the one-reader scan ship without a mutation row: the after-the-dot arm's blank-line skip, and the bare import after another statement. Both only widen what the scan catches. The other two: three docstring wording slips, and one results note that does not name W2-T5-M1's moved first red case.
  - Four new evasion spellings, none in the tree or in W3's files: U+2028/2029 in a line comment, backslash-CRLF in a string, a string-named import specifier, and a type argument's `>` before a division.
  - **Ruling:** accepted, and #319 merged at its reviewed head.
- **2026-10-09: an undispatched review run pins its work run (coordinator lesson).** Review 343 was opened and then waited on the daily cap. When `main` moved, the coordinator could not close 343 (`not-dispatched`), and that blocked sending run 315 back (`review-in-flight`). The workaround: the worker merged `main` while 315 stayed at awaiting-review. 343 then dispatched against the merged tip, and 315's fingerprint was corrected after 343 closed. Open a review run only when its dispatch can follow at once.
- **2026-10-08/09: claim agreements for W3.**
  - Claim 1105 (ccrc-history B1) on `single-definition.test.ts`: agreed by its coordinator and holder. It ended when #315 merged.
  - Claims 1115 and 1116 (box-token-lifecycle wave 1, PR #330) cover `server.ts`, `auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts` and `single-definition.test.ts`. Agreed by the holder: the second PR to land merges `main`, keeps the other's routes, census entries and blocks, and re-measures every count.
- **2026-10-08: W3 approved and opened.** The operator accepted the plan ("plan accepted"). Run 342 opened with block 4464 to 4479. Task 9 Step 7 defines the first six, for (d), (i), (j), (s), (v) and (w); the other ten are reserve. A drift replay on `main` plus W2 found only Task 8's route counts moved (#320 added two routes). The brief settles that by re-measurement, and a review of the brief found six defects, all fixed before dispatch.
- **2026-10-09: W3 ruling during the wave: a WebSocket upgrade bypasses the docs headers (coordinator, mail 4082).** The root websocket plugin answers an upgrade to a docs route with a 101 before the docs plugin's `onSend`. The upgrade passes the gate and provenance first, carries no body and runs no exec, and a browser cannot reach it. It was ruled a deviation (4471), like refinement (d), and pinned by three tests.
- **2026-10-09: W3's review (run 361, tip `77862e265`).** All eight deviations (4464 to 4471) are real, with true rationales. 13 findings: four important guards had no failing case (the show shape at the route, provenance at `onRequest`, the cache-hit raster rules, two tree shape clauses). Fix round 1 also moved the lane's admission and overflow comparisons into L1, and the blob cache now copies at fill, so its charge bounds the memory it holds. The generation-map growth (about 560 B per refreshed name) stays the plan's carried item. Scoped re-review 364 was clean, and #339 merged at its reviewed head.
- **2026-10-09: W4 planned in stages (coordinator).** Ground scouts and an architect, writers that applied each task to a scratch tree, then a three-lens review with refuters and one fix pass. The stages kept the coordinator's mail gate from going deaf for hours. Four departures from the spec's text: (a) six rows written against W5 parts are proved on W4 stand-ins, and their W5 halves move to W5's brief; (b) M4.M1's plugin-order mutation cannot fail, so it is replaced; (c) `docs-sw` counts with bash builtins, not `grep -c`; (d) `docs-sw` SKIPs on either fleet signal. W4's run is open with block 4768 to 4783.
- **2026-10-09: two operator questions from W4's planning.** Q1: should chat show images only for absolute `http(s)` URLs? That is stricter than U3's root-relative and protocol-relative refusal, and closes the path-relative same-origin GET. The plan follows the spec; a ruling changes one predicate and adds a deviation in Task 10 Step 8. Q2: W6's M5.16 scan forbids `postMessage` in the Markdown code, and W4's worker files need it. The Share/Export spec amendment should exempt them.
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
- **W2's one-reader scan residue** (review 343): two unpinned widening arms, three docstring wording slips, the W2-T5-M1 note, and four evasion spellings to add to its "Known evasions" list. This is for the next wave that edits `docs-source.test.ts`, or for W7.
- **W3 residue:** two Task 12 tool texts and one Notes count (review 364); the plan's Task 4 Decision 1 text against the moved L1 verdicts; W2's closed plan rows anchored on `laneAdmit`'s old inline clause. For W7's prose pass: the `coord/store.ts` and `coord/close.ts` comments that say no `app.setErrorHandler` exists, §5.3's "every docs response", which should name the router-level and upgrade escapes, and W4's two stale comments (`pwa/src/lib/api.ts`, `server/test/sourceScan.ts`).
- **U5:** the private vulnerability report is not filed yet. The spec's one-line mention is public since #301.

## Next-wave brief (W4), for run 367 once the operator approves the plan

- **Plan:** `docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`, Tasks 1-12. Task 11 is the held-out whole-branch review; Task 12 pushes and opens the one PR.
- **Base:** `main` at dispatch, at or after the plan's `6fc7ef115`.
- **Routing:** matrix row "worker executing a spec'd plan". Opus·high main loop, Sonnet·high implementers, Opus·high task reviewers and Task 11's panel, workflows off, `compact 40`.
- **Branch discipline:** commit on the workspace's own branch, never a separate feature branch.
- **Deviation block:** 4768 to 4783. Task 10 Step 8 defines the first four, plus any operator ruling the brief names (Q1).
- **Claims:** the plan's shared-file list, checked at dispatch and before each task that edits one.
- **Carried constraints:** the list above.
