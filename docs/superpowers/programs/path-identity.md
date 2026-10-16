# Program: path-identity

Spec: `docs/superpowers/specs/2026-10-12-path-identity-design.md` (W0; merged as #360 = `837a099c0`, 2026-10-12 18:48)
Plans: `docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md` (W1a), `docs/superpowers/plans/2026-10-12-path-identity-w1b-ccd-id-hardening.md` (W1b), `docs/superpowers/plans/2026-10-15-path-identity-w2-absences-and-mounts.md` (W2); the W3 plan later
Contract: `docs/superpowers/programs/child-reclamation-contract.md` (this programme continues CCR-15's contract; its rulings land in a new section)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: **a fresh child per wave**
Parent programme: `child-reclamation` (CCR-15). Its contract R71 names this follow-up.

**What this programme is.** CCR-15's destructive verbs compare a spelling where their safety argument needs an
identity: an id string where it needs the session the id means, and a path string where it needs the inode the
path reaches. This programme replaces each such comparison with an identity check, or holds when identity cannot
be measured. Every change refuses or holds more at the verb it touches. The spec's section 7 lists all 41 carried
items, each with its wave and its decision.

## Waves

Run-level wave numbers map onto the spec's wave names as below. W0 (the spec) needed no run. W4 is not scheduled
(PG1 B); the collector's Settings switch is CCR-15's wave 10, not a wave here (SW6 A).

| # | spec name | scope | deploy class | PRs | state |
|---|---|---|---|---|---|
| — | W0 | the spec, this ledger, and the contract's rulings section | docs | #360 | **merged** `837a099c0` (2026-10-12 18:48); the contract section rides the first plan's docs PR |
| 1 | W1a | the server's id gate (spec 2.3): `isRegistryId`, `readSessionRecord.kind`, `RegistryRead.refused`, the split of the 12 `readRegistry` callers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams, and the stop builders' order | server | #397 | **accepted** (review 474); run **399** in its landing round after #384 merged (2026-10-15 23:23) |
| 2 | W1b | ccd's id fix (spec 2.4 to 2.6): the decision-flag loops, the predicates, the composed-id cap, the reap-lock order, the dot-leading entry rule, and the real-binary parity pins | **ccd/ccd** | #410 | **accepted** (review 478); run **433** in its landing round after #384 merged (2026-10-15 23:23) |
| 3 | W2 | absences and mounts (spec section 3) | ccd/ccd + server, fleet box first | — | not opened; **plan written** 2026-10-16 (grounded on a projection of #384, #397 and #410; framed, drafted, reviewed in slices, fixed); 25 deviation numbers issued and defined; dispatches after W1b's run closes, with workspace-lifecycle's consent and three coexistence consents |
| 4 | W3 | worktree path identity (spec section 4) | ccd/ccd | — | not opened; after W2; needs workspace-lifecycle's consent |

## Decisions & deviations

- **2026-10-16 01:26 — THE W2 PLAN IS WRITTEN** (`docs/superpowers/plans/2026-10-15-path-identity-w2-absences-and-mounts.md`): Task 0 and seventeen tasks, about 15,400 lines.
  - **Base:** a projection of `main` with #384, #397 and #410 merged, in which both landing conflicts resolve as ruled.
  - **Process:**
    - six Opus grounding reports;
    - the coordinator's rulings, R1 to R45;
    - an architect, a critic (36 objections, all folded) and a reviser;
    - one Opus drafter per task;
    - a review in six slices, each with a Sonnet refuter: 37 of 43 findings stood and were fixed;
    - a convergence review: 17 of 19 stood and were fixed. Its safety lens found no destructive-path risk.
  - **Numbers:** 25 were issued before the commit and are defined singly. The eight substantive departures are D-5162, D-5163, D-5164, D-5165, D-5166, D-5167, D-5168 and D-5169. The seventeen per-task entries are D-5170, D-5171, D-5172, D-5173, D-5174, D-5175, D-5176, D-5177, D-5178, D-5179, D-5180, D-5181, D-5182, D-5183, D-5184, D-5185 and D-5186, for Tasks 1 to 17 in order. R44 amends R37, because a committed plan may carry no concrete placeholder.
  - **Before dispatch:**
    - workspace-lifecycle's consent, by function list, including `_ws_tmproot_aside_settle` and its call in the shared tail, and the `_ws_dir_physical` comment;
    - coexistence consents from run 308's coordinator, the delegation broker's coordinator and ccrc history;
    - W1b's run closed.

- **2026-10-15 23:23 — THE NAMED TRIGGER FIRED: #384 merged (`0b3ff2f62`). Both landing rounds are sent: W1a (5279) and W1b (5280). Runs 399 and 433 are back at `working`.**
  - **The probes against the new main:** W1a conflicts in `single-definition.test.ts` only (keep every block, W1a's first). W1b conflicts in the contract's two §17 notes only (keep both, #384's first). Everything else merges automatically.
  - **Main since `a3cebde1b`:** #426 (docs), #427 (PWA ask sheet), #428 (drawer), #431 (PWA session facts) and #384.
  - **W1a's round:**
    - the merge;
    - `collect-id-pins` re-pointed only if it reds (a projection with #384 was green);
    - review 474's F3 word;
    - the absorption recorded in place;
    - runs, including `ui/` and `pwa/` after #419.
  - **W1b's round:**
    - the merge;
    - the fourth absorption in the R93 bullet and D-5085;
    - review 478's widths in D-5082;
    - fix round 2's merge run list.
  - **After each wave-done:** a scoped review of the merge, then the close and the landing.

- **2026-10-15 21:18 — REVIEW 474 IS CLOSED AND ACCEPTED: W1a's content is done (5235). Run 399 waits at `awaiting-review` for #384 to land.**
  - **Review 474 (5234)** read `3b78e8239`, with no class (a) or (b) finding at any lens.
    - **SAFETY:** F1's drop does what the ruling says. Every judged order waits its full grace with a true span. K, K-absent, K-marker-worker and K-marker-claimant red as claimed. K-dead and F2's fold are equivalent at lane level: no lane case reds either.
    - **Panel:** 59 agents; 4 findings confirmed (two merged), 14 refuted.
    - **Runs:** the server suite's reds are all main-red or load (green alone). CI on #397 is green, 476 files.
  - **Three record-only findings:**
    - the third commit `3b78e8239` lies beyond the ruled order;
    - `2a2609a0b`'s message miscount, recorded and not rewritten;
    - a garbled parenthetical in the (E) comment (`tick-refused-lanes.test.ts:249`), which rides the landing round.
  - **The landing round,** once #384 is on main:
    - merge main: `single-definition` keeps both blocks, this branch's first;
    - re-point `collect-id-pins.test.ts`'s two executor calls to `r.job(id)` if #384 requires it;
    - F3's word;
    - runs, push and the wave-done;
    - then a scoped review of the merge, the close and the landing.

- **2026-10-15 20:32 — REVIEW 478 IS CLOSED AND ACCEPTED: W1b's content is done (5228). Run 433 waits at `awaiting-review` for #384 to land.**
  - **Review 478 (5225)** read `617fc285c`:
    - no class (a) or (b) finding;
    - the dictated text is word for word;
    - under a 290-byte cut, `ccd-ws-collect-reprove` reds and `ccd-child-reclaim-why-cap` stays green, as the new sentence says;
    - CI is green, a 301-file selection.
  - **One record-only finding:** D-5082's 289/260 figures assume a 16-byte id, a 19-digit ns and a 7-digit pid, and the plan names only the HOME. It rides the landing round.
  - **The landing round,** once #384 is on main:
    - merge main, keeping both §17 notes, #384's first;
    - record the fourth absorption;
    - name the widths in D-5082;
    - runs, push and the wave-done;
    - then a scoped review of the merge, the close and the landing.

- **2026-10-15 20:07 — W1b FIX ROUND 3 IS VERIFIED (5222): run 433 → `awaiting-review` at `617fc285c`, PR #410. Review run 478 is opened, scoped to `9d13d5dd7..617fc285c`.**
  - **Re-measured:**
    - the PR head and the remote branch both read `617fc285c`;
    - one docs commit, eight added lines in the plan and the contract;
    - the dictated text is word for word;
    - D-5082 now counts thirteen;
    - no D- token in the commit message;
    - the PR body's new line is free of private names.
  - **No merge:** main is still `a3cebde1b`, so #384 has not merged and there was no trigger.
  - **Runs:** `suite: red` (clause 15), `failure: shallow`. The prose, `collect-lane-prose` and the pre-lock pin are green alone, and so are the guards.
  - **The worker's one addition beyond the bullet list:** D-5082's sentence on why no case is added, taken from the rulings. The review checks it.

- **2026-10-15 20:03 — REVIEW 477 IS CLOSED, AND W1b FIX ROUND 3 IS SENT (5221): one false sentence, in two places.**
  - **Review 477 (5220)** read `9d13d5dd7`:
    - no shipped-behaviour defect;
    - CI is green, a 301-file selection;
    - every substitution of the worker's held.
  - **Two minor findings, one sentence:** the contract's SEC7 bullet and D-5082 said the pin pads its stub into the window where the no-lock clause is cut. The sentence was dictated by fix round 2's ruling. In fact the pin's detail is at least 372 bytes, so the clause is dropped whole.
  - **The fixture-HOME sentence holds:** at least 324 bytes after the dash mapping, at CI's TMPDIR.
  - **Ruled:**
    - the sentence is replaced, in both places, by one that says what the pin pins and that no case pins the 248-to-299 window;
    - D-5082 records the measured windows;
    - no new case: the shared cut has its own pins. No new number.
    - If #384 has merged by the probe, the round merges main and records the fourth absorption. Otherwise it does not wait.
  - **Grounding:** two checkers and twelve refuters weighed twelve objections, one of them raised twice. Five stood, and four refuted ones were folded in as well. Among them:
    - the file that pins the cut's 300-byte position;
    - what the resume case asserts;
    - one insertion point;
    - a prose test that reads the edited note;
    - the absorption record.

- **2026-10-15 19:38 — W1b FIX ROUND 2 IS VERIFIED (5217): run 433 → `awaiting-review` at `9d13d5dd7`, PR #410. Review run 477 is dispatched on an Anthropic lane, scoped to `b55fd0a4e..9d13d5dd7`.**
  - **Re-measured:**
    - the PR head and the remote branch both read `9d13d5dd7`;
    - four commits, with no merge: main is still `a3cebde1b`, so there was no clause 16 trigger;
    - `ccd/ccd` is unchanged;
    - no D- token in any commit message.
  - **The round:** F1 to F8 as ruled. The worker's own review fixed one important finding and three minors (`9d13d5dd7`). `suite: red` (clause 15), `failure: shallow`. Every file the round changed is green alone, and so are the guards.
  - **The 19:14 entry's rc-3 sentence is corrected.** It said the live rc-3 line carries no clause. In fact the rc-3 detail carries the record path, and the `~/.cc-tmp` path when that path cannot be resolved, so its length grows with HOME.
    - The worker measured it, and I confirmed it from the format strings at the tip: 291 and 262 bytes under a 10-byte HOME, and 276 and 252 under a 5-byte one.
    - On a short live HOME the clause is therefore cut, not absent. Review 473's 318 bytes was measured on fixture HOMEs.
    - The contract's SEC7 bullet and D-5082 state both cases. Review 477 measures the fixture-HOME sentence at CI's shortest TMPDIR.
  - **Five substitutions, accepted (5219):**
    - no D- token in the contract note;
    - function names in place of line citations;
    - F4's registry-branch assertion is soft as well;
    - a "Task 9, measured later" bullet;
    - the entry counts, edited in place.

- **2026-10-15 19:14 — REVIEW 473 IS CLOSED, AND W1b FIX ROUND 2 IS SENT (5214): eight minor findings, prose and one test fixture.**
  - **Review 473 (5211)** read `b55fd0a4e`. It found no shipped-behaviour defect; CI is green, and no local red is the round's.
  - **Six broken promises in prose:**
    - the contract misses the substantive departure `prelock-no-lock-clause-follows-the-detail` and four slugs found while building;
    - a test title and a pin's comment overclaim;
    - the rename rows' branch assertion cannot red in their fixture;
    - the history store's `recall-off/<id>` is missing from the residual names.
  - **Two record-only:** the post-merge tokenizer widening, and the third absorption of main.
  - **Ruled:**
    - the contract gains the SEC7 bullet, with the live rc-3 fact: its detail alone passes the cap, so the live line carries no clause;
    - the rename rows get a real worktree and a soft document assertion, so their branch assertions red under the mutation;
    - `recall-off/<id>` folds into the existing history slug;
    - D-5081 records the widening, and its normalised-shapes bullet now says which fields are length-checked. The argument-literal gap is carried to the next server-side wave as `history-field-literals-passed-as-arguments-outside-the-field-max-scan`;
    - no new number: each sentence goes in place in the per-task entries.
  - **Grounding:** two checkers and thirteen refuters weighed thirteen objections; twelve stood and one was refuted. The PR list, the length-check scope, where the carry lives, F4's measurement shape, Task 12's sentence and the title's scope were all corrected.
  - **Cross-PR:**
    - #384 landing first makes #410's contract conflict on two "§17 as built" sections: keep both, #384's first;
    - #397 conflicts with #384 in `single-definition.test.ts`;
    - #397 and #410 merge cleanly with each other.

- **2026-10-15 15:44 — W1a FIX ROUND 3 IS VERIFIED (5188): run 399 → `awaiting-review` at `3b78e8239`, PR #397. Review run 474 is opened, scoped to `4d7939764..3b78e8239`.**
  - **Re-measured:** the PR head and the remote branch both read `3b78e8239`, and `git merge-tree` against `origin/main` `a3cebde1b` is clean.
  - **The round:**
    - **F1 (`4b779eb4c`):** a sweep that refuses a subject's id drops that subject's stall clocks. The worker's lane pins (E) and (E') red first: before the fix, the review's "absent for 1h 3m" notice came at once. Mutation K and its per-lane parts red, and K-dead is equivalent at lane level.
    - **F2:** the L4 fold is measured equivalent under the drop.
    - **F3 and F4 (`2a2609a0b`):** D-5044's entry is edited in place, and four read-scope sentences are reworded.
    - **`3b78e8239`:** the worker's own SAFETY review accepted the round, with seven minors, six fixed.
  - **Main, absorbed on a conflict (`eac01c765`, main `cb72ca064`):** `single-definition` kept both blocks, as confirmed in 5135. At push, main `a3cebde1b` merged cleanly, so there was no further merge.
  - **Signals:** `suite: red`, `failure: unclear`. The first full run was Task 17's (clause 15). After the merge, no red belongs to the branch:
    - main-red: `boot`, `ccd-review-335-pins`, `tmp-sweep`, and `ccrc-doctor`'s afterAll;
    - load: `session-hook` and `update-store-nodes`;
    - environment: `docs-routes`.
    - Agent and pwa are green.
  - **Recorded:** the worker consented, under its claims, to run 360's additive edits (5103, 5142); whoever lands second merges. #384 is still open, so `collect-id-pins.test.ts` is unchanged.

- **2026-10-15 15:01 — W1b FIX ROUND 1 IS VERIFIED (5173): run 433 → `awaiting-review` at `b55fd0a4e`, PR #410. Review run 473 is dispatched on an Anthropic lane.**
  - **Re-measured:**
    - the PR head and the remote branch both read `b55fd0a4e`;
    - `git merge-tree` against `origin/main` `a3cebde1b` is clean;
    - `ccd/ccd` at the tip reads `ccrc-unmodified`.
  - **The round:** one commit per ruling, in the ruled order:
    - F1, the line-neutral re-fold: the census is 7/7 at 147;
    - F2, the fourth census line;
    - F3, detail first, its pin independent of TMPDIR;
    - F4, seven full-argv lone-key rows;
    - F5, `enable`'s usage check before any lock;
    - F7, `enable` uncapped;
    - the prose;
    - the numbers: 32 definitions, listed singly;
    - four doc minors from the worker's own review.
  - **Main, absorbed on a conflict:** the merge (`7bfef06cc`) conflicted on `ccd/ccd`'s stamp line only, and was restamped. After it, one test pin went red on #404's history CLI. `b55fd0a4e` widens `ccd-id-cap`'s field placeholder to read it, adds no row, and has no record yet. The review judges both.
  - **F13:** re-measured at the tip, so the slug is now `census-blind-below-line-5818` (D-5003, Task 4).
  - **Signals:**
    - `suite: red` (the first full run, clause 15); `failure: shallow`;
    - no red belongs to the branch: the main-reds are `boot`, `tmp-sweep`, `ccrc-doctor` and `ccd-review-335-pins` (long TMPDIR only), and the rest are load flakes, green alone;
    - agent and pwa are green.
  - **Review run 473:** scoped to `65614d350..b55fd0a4e`.
    - SECURITY on F4 and F5;
    - SAFETY on F3, including where the 300-byte cap cuts;
    - corpus, stamp and words, including the six summaries the worker corrected against the code;
    - the named items: `b55fd0a4e`'s widening and its record, and F13's slug.

- **2026-10-15 07:08 — REVIEW 465 IS CLOSED (done, mail 5099). W1b's FIX ROUND 1 IS SENT (mail 5100), and run 433 is back at working.**
  - **The review** read `65614d350`, which equals the live tip, and is accepted. The panel ran 132 agents, with none unverified. The SECURITY lens found no flag-spelled id binding a decoy at any builder, and the consent fences and both merges hold.
  - **Two required suites are red:**
    - **session-hook's citation census.** A stale corpus citation lands in a comment the wave rewrote, so both the debt and a second census fact move. Ruled: re-fold the wave's own comment, line-neutral, inside its boundary. No edit to the protected test file, and no consent from another programme.
    - **The archived-expiry census.** It counts the wave's new pre-lock failure site. Licensed: one added line, in rows that child reclamation's wave 7 wrote.
  - **One minor class (a): the plan's own STOP for the pre-lock prefix fired.** The worker's account missed it, because it was measured only at a short TMPDIR. With long paths, the 53-byte prefix cuts the operative clause of a 300-byte detail. Ruled: the detail comes first and the no-lock clause after it, with a committed pin that needs no long TMPDIR. The refused site keeps its shorter prefix, which measured safe.
  - **Pins:** each `--session` verb gets a full-argv row for the trailing lone key, and enable's cap exemption gets a pin. **Enable's empty input** gets an explicit usage check at the top of its block. Letting it fall through, the draft's direction, was measured to open a reap lock and journal against `-demo`, so the grounding rejected it.
  - **Prose:** the cap's stated reason (an over-cap id loses its peers' counts, not its own card; this record's R27 line is corrected the same way), the residual lists, the second absorption of main, and the pre-lock header.
  - **Numbers.** The table needs 32: 21 substantive departures, one of them new at this round, and 11 per-task numbers. It is the issued block of twenty-four, plus eight issued now, listed singly: 5079, 5080, 5081, 5082, 5083, 5084, 5085 and 5086. Each is spelled as a defined entry. The rulings were checked against the tip first, and all ten objections stood and were folded in.
  - **Carried to the next server-side wave:** the route parameter length (Fastify answers 414 for ids of 101 to 128 bytes, which the cap admits), and the session-creation guard. **For the operator:** the pre-existing private names on main, in thirteen places.
- **2026-10-15 04:24 — REVIEW 463 IS CLOSED (done, mail 5083). W1a's FIX ROUND 3 IS SENT (mail 5085), and run 399 is back at working.**
  - **The review** read `4d7939764`, which equals the live tip, and is accepted. It found no class (a) finding at any lens. While a listed-but-refused id stays refused, it draws no act, no composed path or argv, and no clock movement in any lane on the tick, and every ruled mutation reds. The panel ran 135 agents, with none unverified.
  - **One finding re-ruled: a refused sweep now drops the subject's stall clocks; it no longer keeps them.** Fix round 2's ruling kept them. The review measured an unlisted, then refused, then unlisted sequence: the first sweep after the re-unlisting mailed a dead notice at once, counting about an hour of listed time as absence and skipping the dead grace. A refused sweep observes nothing about its subject. So its clocks restart, the rule D-3750 already applies to an unobserved gap, and that matches main, where the listed row cleared the clock. Two new cases pin it, and a keep mutation reds both.
  - **Also in the round:**
    - after the drop, the arm's L4 constructor is measured, and its fold recorded as equivalent or pinned;
    - D-5044's entry says which pins red first and records the worker's two measured re-points;
    - four "nothing is read" overclaims are narrowed to the ruled scope.
    No new number.
  - **Recorded, no change:** two honest reports a refused id can still draw (coord-deaf off held mail, and the mail-stuck report), and one cosmetic loss in mail decoration.
- **2026-10-15 01:34 — W1b IS VERIFIED (wave-done 5059, PR #410). Run 433 is at awaiting-review, and review run 465 is opened.**
  - **Re-measured:** the live tip and PR #410's head are both `65614d350`. The run was still at `dispatched`, so it was advanced to working and then to awaiting-review, each step with the same fingerprint.
  - **The branch** merged main twice: #395, and then `c7776b080`, whose one conflict was the generated stamp line, regenerated. The net diff is 22 files, and the merge-tree probe is clean. None of its 17 commits carries a D- token, and no added line carries a private name.
  - **The suite** is red on the first full run, with `failure: shallow`: one break is this wave's. `archived-expiry-policy.test.ts`'s census sees a fourth `cmd_ws_collect failed probe-unmeasured` site, Task 9's pre-lock refusal. The file is outside the HARD BOUNDARY, so the worker did not edit it, and the one-line fix needs a license at the fix round.
  - **A post-merge finding:** session-hook's citation debt for `ccd/ccd` reads 146 on the merged tree. A stale spec citation lands in a comment Task 5 rewrote. The file is protected and held by ccrc history's run 354, so lowering the number needs a license and that run's consent.
  - **The issued block,** twenty-four numbers, is listed singly in the plan. The numbers are assigned at the fix round.
  - **Review run 465** is the wave's first review. It runs the held-out panel, plus the plan's four lenses: SECURITY and SAFETY on opus at xhigh, the corpus lens on opus, and narrowing on sonnet. It confirms or refutes both named items by measurement.
  - **Carried for a later wave:** a server guard on `POST /api/sessions`, for a stripped flag whose positional collapses to the id form. **Recorded for the operator:** pre-existing private names on main, in one ccd comment and one test file.
- **2026-10-15 01:16 — W1a's FIX ROUND 2 IS VERIFIED (wave-done 5052). Run 399 is at awaiting-review, and review run 463 is opened.**
  - **Re-measured:** the live tip and PR #397's head are both `4d7939764`, and the server accepted the fingerprint. The round is eight commits over 18 files, with no merge of main: #384 is still open, so the named trigger never fired. The merge-tree probe against `c7776b080` is clean.
  - **Checked here:**
    - `server.ts` and `reclaim.ts` change comment lines only;
    - every edit to `dead-coordinator-lane.test.ts` sits inside the one consented case;
    - D-5044 is defined once;
    - no commit message carries a D- token;
    - no private name is added. The one absolute path is the existing fixture stand-in `/home/rc`.
  - **What the round built for 5044:**
    - a distinct refused arm in the stall lane, held as unmeasured ahead of the marker push, with mail-stuck's report kept;
    - the coordinator judge holds a refused claimant;
    - the claim lane renews a claim whose holder is refused, and the hard cap still fells it;
    - the divergence census leaves a refused id out;
    - census pins for each of the four hand-offs, and clock pins added after the worker's own round review.
    The worker records two measured re-points of the rulings' predictions in 5044's entry.
  - **Review run 463** is scoped to `a591e0441..4d7939764`. Its SAFETY lens (opus, xhigh) asks whether a listed-but-refused id can still draw any act, report, path, argv or clock movement on the tick, in any lane.
- **2026-10-14 20:25 — REVIEW 457 IS CLOSED (done, mail 5030). W1a's FIX ROUND 2 IS SENT (mail 5033), and run 399 is back at working.**
  - **The review** read `a591e0441`, which equals the live tip, and is accepted. Inside fix round 1's diff it found no class (a) finding. `server/src` is comment-only, proved with the TypeScript printer. The one consented case meets its proofs, every ruled mutation reds, and no stored non-registry claimant id is measured absent or crashed. The panel ran 88 agents, with none unverified.
  - **One W1a-wide defect, ruled fixed in #397 under a new number, 5044** (Task 6, `tick-lanes-hold-a-refused-id`).
    - Lanes on the main watch's tick read a listed-but-refused id as absent. The stall watch's run verdict mails a `dead` notice for a run whose stored worker id is refused. Main read that row as present, so W1a introduced the notice.
    - The rulings were checked against the tip first: two Opus checkers, then a Sonnet refuter for each objection. The check widened the defect to three more places on the same tick:
      - the claim lease lane lapses a legacy claim with a refused holder as `session-gone`;
      - the divergence census reports a false `claim-divergence`;
      - the stall lane's coordinator judge reads a refused claimant's marker file.
    - Spec §2.3 says the main watch retains prior state for refused ids rather than observing their absence. So `tick` now hands its `refused` set to each lane, and each lane holds it as unmeasured.
    - Mail-stuck's report of a held delivery stays, because it is the only signal for that mail.
    - Holding a refused worker ahead of the marker push departs from the stall-watch spec's evaluation order. Number 5044's entry records it.
    - Carried, with no number: `unlisted-non-registry-id-reads-absent-on-the-tick`.
  - **Prose:**
    - comment-only corrections: two parts-only lead-ins, the census prose, and `ClaimantVerdict`'s list;
    - in-place fixes of two as-built sentences.
  - **Tests:**
    - the lone-surrogate case's instants are separated by 1 ms, inside the one consented case. Workspace-lifecycle's coordinator was told (mail 5035);
    - one fixture is de-duplicated.
  - **Numbers.** No other number is new; fix round 2 sentences go in 4873, 4880, 4881 and 5004. Main is merged only if #384 lands first, which is the named trigger.
- **2026-10-14 16:23 — CONSENT TO SESSION CONTINUITY's RUN 308 BESIDE W1b (request 5007, answer 5010, R56).** Run 308 is planned and not dispatched. It edits:
  - in `ccd/ccd`: `_resume_env`, `_operator_choice_keep`, a new `_operator_choice_promote` beside it, the caller comment above `_operator_choice_read`, and `_sync_uuid`;
  - in `ccd/ccrc-doctor-checks`: `_check_scope-sweep`;
  - and it maintains the citation and census pins.
  - **Measured disjoint, here.** The check was against W1b's unpushed tip, not the worker's own answer.
    - In `ccd/ccd`, W1b's hunks fall in 31 functions: the id helpers, the collector, expiry and reclaim helpers, and the id-taking verbs. They also touch the generated stamp line. None of them is a run 308 function or the comment above `_operator_choice_read`.
    - In the doctor checks, W1b's only hunk is the comment inside `_check_pools`.
    - Run 308's plan names none of W1b's functions. The two share no other file, and W1a shares none with run 308.
  - **The fences.**
    - Each side edits only its own lines. Run 308 adds no id-taking verb, argv composition, flag parse or id grammar.
    - The second lander merges main (never a rebase), keeps both sides and re-anchors by content. It takes either side of the stamp and restamps, and re-measures the citation and census pins.
    - Main is absorbed only on a clause 16 trigger.
    - Any overlap newly measured on either side stops for scoped agreement.
  - **Scope.** The consent covers W1b only. W2 and W3 measure their overlap at their own dispatch. It is coexistence consent: it does not accept the plan, order a merge or set a landing order.
- **2026-10-14 15:13 — W1a's FIX ROUND 1 IS VERIFIED (wave-done 4980). Run 399 is at awaiting-review, and review run 457 is dispatched.**
  - **Re-measured:** the live tip of `ws/swift-canyon` and PR #397's head are both `a591e0441`, and the server accepted the fingerprint. The round is one merge of main (`b8e4c39f8`, main `b953aefa4`) and then seven commits over seven files. The merge's tree equals the `merge-tree` probe, so nothing was resolved by hand.
  - **Checked here:**
    - the `server/src` diff (`ccdargv.ts`, `server.ts`) changes comment lines only;
    - the 25 numbers are each defined once under the plan's `## Deviations found`, with no range;
    - no commit message carries a D- token;
    - no private name is added;
    - the merge-tree probe against today's main (`6da6fa4bb`) is clean, so nothing is absorbed.
  - **The worker's suite verdict:** red, cause unclear. The first full run, at the end of the wave, was red, and this round's whole-branch run found no red that belongs to the branch. The review re-measures every red.
  - **Review run 457** is scoped to `b8e4c39f8..a591e0441`. It was dispatched at 15:12 on an Anthropic lane. Its lenses:
    - SAFETY (opus, xhigh) on F1's one case and its three proofs;
    - stop's prose and pins;
    - test integrity, with mutations I, W and A;
    - words and deviations.
    The whole-branch checks are the HARD BOUNDARY plus consent 4799, the merge's tree, and the probe against main.
  - **Forwarded to workspace-lifecycle's coordinator (mail 4982):**
    - the one case as built, which reaches the point the veto notice named. An objection still re-rules before #397 merges;
    - the carried `dead-coordinator-docstring-predates-the-claimedby-gate` (`deadCoordinator.ts:508` on main), which that programme corrects on its next touch.
  - **Named by the worker and judged in the review:** `null-check-deletion-reds-stop-by-a-composed-stop`, `file-header-label-aligned`, and three comment fixes after the docs commit.
  - **Overlap:** if #384 lands first, `collect-id-pins.test.ts`'s two executor calls become `r.job(id)`.
- **2026-10-14 10:15 — OK TO DELEGATION BROKER W3's THREE IN-PLACE EDITS IN `ccd-workspaces.test.ts` (proposal 4830, answer 4832, R56), beside W1b's claim 1285.** Run 360's `_reg_purge` adds one unlink (`.joined`), so the file's cost ratchet moves: RM_CALLS goes from 28 to 29, the comment's count from 32 to 33, and one comment clause is added. W1b's only hunk in that file (bright-hollow at `cc82157bc`) is the `_ws_project_valid` comment at :374, in place, about 165 lines away. Both edits are line-neutral, so either landing order merges cleanly.
- **2026-10-14 06:12 — W1a's FIX ROUND 1 IS SENT (mail 4800). Run 399 is back at working.**
  - **The rulings were checked first:** four Opus checkers and four Sonnet refuters, against `f65651af8` and `b953aefa4`. These objections stood and are folded in:
    - F1's dirty-seed arm needs a non-sealed start. On that arm a wildcard `clustered` trip {A, S} DOES form, so A is held while S's run stays open, and only the abandon door releases it. The sealed control instead lets A end after its hour as a lone crash.
    - The premise is impossible because of `measureClaimant`'s arm, not because of the door gate.
    - The wrapper clause's reason as an equivalent mutant was restated (on the fallback arm, the pair clause refuses on its own).
    - Each of the four pair-part cases names both of its refusing clauses.
    - F7 names its isolating mutation.
    - F8's single red is the wedge mutation, Review Focus 3's literal failure mode. Removing the exclusion is equivalent for the resume arm.
    - Ten number-table attributions were corrected. Three Task 17 findings moved to "named, with no number".
  - **One new carried item:** `dead-coordinator-docstring-predates-the-claimedby-gate` (`deadCoordinator.ts:507-509`, workspace-lifecycle's file).
  - **The table:** `w1a-fr1/rulings.md` in the archive, with 11 substantive numbers (4860 to 4869, and 5004) and 14 per-task numbers (4870 to 4883), each written singly in the plan.
- **2026-10-14 06:08 — WORKSPACE-LIFECYCLE HAS NO OBJECTION TO F1's ONE-CASE RE-POINT (mail 4799).** Its coordinator reconciles path identity's spec §2.3 with workspace-lifecycle's spec §5 and asks the one case to keep three proofs. First, a dirty-seed arm: the exact A/S snapshot with its fallback flags and the ASCII `%uD800` spelling, kept across a restart, with A still working after two hours. Second, a measurement-only control that still supplies S's spawn history, so that S reads unmeasured and no crash-derived trip forms; folding `bad-id` into `absent` would red it. Third, no crash-anchor upsert for S, pinned through the write calls or the whole key set. All three are in ruling F1. The no-objection is scoped: it is not wave acceptance and not permission to merge #397.
- **2026-10-14 05:59 — REVIEW 432 IS CLOSED AT `f65651af8` (mail 4797), AND W1a GOES TO FIX ROUND 1.** The live tip matched the reviewed tip. The review run was advanced to working and closed `done` on the reviewer's own `{reviewedTip, report}`.
  - **The review:** 46 panel findings confirmed, all minor, plus one CI finding. Every SAFETY mutation row went red, then green. The hard boundary, the consent regions and the public-name scan are clean.
  - **F1 (a), the merge blocker: #351's lone-surrogate case in `dead-coordinator-lane.test.ts` is red on the merged tree.** The case expects a non-registry coordinator id to read crashed, while W1a's `measureClaimant` answers `unmeasurable`.
    - Ruled for W1a, from spec §2.3: every absence-acting caller, `reclaim.ts:128` named, treats `bad-id` as unmeasured, never as absent.
    - W1a's worker re-points that one case. The lone-surrogate spelling still reaches the breaker snapshot, through the dirty-seed path, and S is never measured crashed.
    - Workspace-lifecycle's coordinator has the notice, with a veto open until the fix round's wave-done (4798).
    - It is clause 16's `main-passes-red` trigger, so the worker merges main first.
  - **The rest:**
    - F2 to F4, F13: stop's prose and one project-clause pin. The wrapper clause is recorded as an equivalent mutant.
    - F7 and F8: the sibling 503 cases isolated, and Review Focus 3's three arms pinned.
    - F5 and F6: as-built corrections.
    - F9 to F12: recorded with no change.
    - Both departures beyond the plan are approved.
  - **Numbers:** run 399's block of 24, plus one more issued now for this round's new departure: **5004**, `lone-surrogate-claimant-case-re-pointed`. That makes 11 substantive departures and 14 per-task correction numbers. The table is in `w1a-fr1/rulings.md` in the archive.
- **2026-10-14 04:53 — delegation broker confirms (4796).** Its CCRC_DOCTOR_CHECKS entry already had row 3a's licence (4695). Wave 3 edits none of W1b's four existing test files and never touches `ccd-ws-add-dash-id.test.ts`. Its worker now treats a 409 naming run 433 as licensed on `ccd/ccd` within the fences, on Task 14 in `ccrc-doctor-checks` and on existing ccd-ws-add test pins.
- **2026-10-14 04:52 — W1b's RUN 433 IS DISPATCHED → `ccrc-pwa-bright-hollow`, on an Anthropic lane** (a fresh workspace; `skillState: present`; route opus, xhigh, sonnet subagents, workflows on, compact 40). The dispatch body is `w1b/dispatch.json` in the archive.
- **2026-10-14 04:52 — DELEGATION BROKER CONSENTS (mail 4791, R56), SO W1b's BRIEF IS COMPLETE AND RUN 433 GOES TO DISPATCH.**
  - Run 360's `ccd/ccd` regions, as measured by its coordinator: `_reg_purge`'s GENERATION LAST line, where a `joined` unlink is appended, line-neutral; and, from Task 5 (not yet written), the owner spool directory beside `_child_tmpdir` and its call in `_spawn_start`, `delegation-events-v1` in cmd_caps, and the stamp line.
  - W1b keeps off all of those. Run 360 keeps off W1b's list, and its new code stays out of the temp-root witness block, where W1b's Tasks 1 and 7 insert. Both sides keep to the frozen citation corpus, and the second lander re-runs the citation census.
  - My answer (4793) consents to two of run 360's paths on the same terms:
    - `ccd/ccrc-doctor-checks`: Task 14's new check and remedies. The CCRC_DOCTOR_CHECKS list entry is box-token row 3a's to grant, not mine.
    - `server/test/ccd-ws-add*.test.ts`: W1b edits no existing one. Its new `ccd-ws-add-dash-id.test.ts` stubs the spawn path, so the second lander runs it after the merge.
  - The brief (7962 bytes) carries all three consents and the fences, with the plan's 14 task headings as items. Its route is opus, xhigh, sonnet subagents, workflows on and compact 40.
- **2026-10-14 04:49 — WORKSPACE-LIFECYCLE CONSENTS TO W1b's THREE `ws-expire` EDITS (mail 4789), AND DELEGATION BROKER W3's CLAIM 1281 ON `ccd/ccd` NEEDS ONE MORE (asked, 4790).**
  - 4789 consents to exactly 4721's three edits: the `--session`/`--expect` pairs in cmd_ws_expire, its `_reg_id_ok` entry line, and the `_ws_tmproot_id_ok` entry line of `_ws_expire_audit_contained`. It covers source edits only, never a run of ws-expire. `_ws_expire_locked`, #351's locked hunks, EXPIRE-V1, `_ws_expire_refuse_return`, and the refusal, probe and journal vocabulary stay unchanged. Task 5's cmd_enable checks sit above the unchanged refusal-return call, and any wider edit there needs a new consent.
  - Claim 1281 (run 360, soft-delta, taken 02:08Z) holds `ccd/ccd` for W3 Task 2's fix round and Task 5. As read from its intent and W3's plan, it touches `_reg_purge`'s generation and joined lines, the delegation spool and `delegation-events-v1` in cmd_caps. W1b touches none of these. Two interactions are named in the brief, neither a line overlap. Task 13's "cmd_caps identical" compares against merged main's cmd_caps if run 360 lands first. `$REG/<id>.joined` enters Task 7's census without moving the cap of 128.
  - W1b's brief is filled except the delegation-broker consent, and its items are the plan's 14 task headings. It dispatches when 4790 is answered and a slot is free.
- **2026-10-14 04:01 — STALL-WATCH SETTINGS WAVE 4 MERGED AS `b953aefa4` (mail 4786, answer 4788).** A merge-tree probe of #397's `f65651af8` against it is clean (rc 0), so clause 16 has no trigger and review 432 stays on `f65651af8`. **Residue I own:** the spec's §5.1 (`2026-10-12-path-identity-design.md:520`) cites `single-definition.test.ts:5638-5668` for the collector marker's no-writer pin. Wave 4 moved that block down 21 lines, and #384 moves lines inside it. No test reads the citation. I re-point it in my next docs PR after #384 and #397 merge, measured on main then.
- **2026-10-14 00:35 — STALL-WATCH SETTINGS WAVE 4's `shared/api.ts` LINE IS CLEAR OF W1a (answer 4747 to proposal 4745).** Its edit sits at :9597 to :9629 at main 162c91491 and keeps the line count. #397's three hunks start at :9684. The second lander merges main and keeps both sides.
- **2026-10-14 00:22 — REVIEW RUN 432 IS DISPATCHED → `ccrc-pwa-warm-meadow`, on an Anthropic lane** (`skillState: present`; route opus/xhigh/sonnet/workflow on/compact 40). A daily-cap slot freed at 00:22. Brief: `review-432-brief.md` in the archive.

- **2026-10-14 00:16 — box-token's consent is in for W1b's `_check_pools` comment (4725, R56).** Row 3a stays off `_check_pools`, and W1b stays off the box-token lines and adds no single quote in the `_BT_PY_*` blocks. Claim 1272 stands, so the worker edits that comment under the consent without a claim. W1b's dispatch now waits on workspace-lifecycle's PG2 answer and a slot.

- **2026-10-14 00:15 — W1B'S RUN IS OPEN: run 433 (wave 2 of 4).**
  - **Its block, issued singly:** 4980, 4981, 4982, 4983, 4984, 4985, 4986, 4987, 4988, 4989, 4990, 4991, 4992, 4993, 4994, 4995, 4996, 4997, 4998, 4999, 5000, 5001, 5002 and 5003.
  - **Server-box ls-only counts (Task 0 Step 4):** every STOP count is zero; 8 `.uuid` rows; `max-id-len` 31, under the cap.
  - **R27 stays (a), 128**, and R10's census cap stands. Neither was reversed by the operator.
  - **Consents asked:** workspace-lifecycle's coordinator for the three `ws-expire` edits (PG2 A, 4721), and box-token's for the six-line comment in `ccrc-doctor-checks` (4724).
  - **Overlap recorded:** PR #395 (supervisor tick diet W1) edits `ccd/ccd`'s supervisor region, which W1b leaves alone. The second lander restamps.
  - **Review run 432 (W1a) waits on cap-daily**, and W1b's dispatch waits on the consents and a slot. Reviews take slots first.

- **2026-10-14 00:10 — W1A'S WAVE-DONE IS VERIFIED (4718): run 399 → `awaiting-review` at `f65651af8bbf41543e27d356b52a065e2a20af60`, PR #397; 18 of 18 items settled done. Review run 432 is opened.**
  - **Re-measured:** 21 commits on `e4405056e`, no merge of main. `git merge-tree` against `origin/main` `ac60e373f` (after #351, #362 and #394 merged) is clean.
  - **Signals:** `suite: red`, `failure: unclear`. Of 680 files, 7 were red: six main-red with the same cases on a clean main (boot, ccd-review-335-pins, ccrc-install, ccrc-doctor, tmp-sweep, update-store-nodes), and session-hook, red alone on HEAD but green from a scratch worktree on the identical tree. Agent and pwa were green.
  - **Two departures found by the worker's whole-branch review, for the review to judge:**
    - `stop-pair-refused-when-the-pair-is-not-the-id`;
    - `stop-normal-case-seeds-a-well-formed-row`: `routes.test.ts`'s "stops normally" case had passed while composing a stop for a different session.
  - **Carried to later waves:** listed in the wave-done (W1b's wave-lifecycle bad-session rows and real-binary parity rows, among others).
  - **A cross-PR compile break, noted in both briefs:** if #384 lands first, `collect-id-pins.test.ts` needs `r.job(id)`.
  - **#351 IS MERGED (23:22Z, `bedcb26fb`), so W1b's precondition is met.** W1b's run opens once a slot allows, with workspace-lifecycle's PG2 consent asked first.

- **2026-10-13 23:38 — CONSENT GIVEN TO DELEGATION-BROKER WAVE 3 (run 360; 4698 → 4699, R56) over run 399's claim 1273 (`server/test/fleet-health.test.ts`).** Run 360 may add new describe blocks only. Run 399's two edited live-arm cases in "GET /api/fleet — degraded mode" are off-limits to it. The worker was told (FYI).

- **2026-10-13 19:28 — W1A'S IMPLEMENTATION IS COMPLETE ON `ws/swift-canyon` (local tip `f65651af8`, not pushed; 4652).**
  - Tasks 0 to 16 are each task-reviewed. A two-lens Opus whole-branch review (safety; readers, wire and tests) ran, and its fix wave and re-review are clean.
  - Task 17's first full run (48 shards, about 4 to 5 hours at this load) has started; then the push, the PR and the wave-done.
  - **One change beyond the plan, for the review to judge:** `stop-pair-refused-when-the-pair-is-not-the-id`. `stopPairRefused` also refuses (503 `registry-unmeasurable`, no argv) a non-workspace row whose id is not `<wrapper>-<project>`. Before, `/stop` and `/archive` composed `stop <wrapper> <project>` for such a row, which names a different session; for example, a workspace row whose `.workspace` read failed would stop the project's main checkout and answer 200. The review brief will name it for the SAFETY lens to judge.

- **2026-10-13 07:04 — RUN 399 (W1a) IS DISPATCHED → `ccrc-pwa-swift-canyon`** (`skillState: present`, brief queued; route opus/xhigh/sonnet/workflow on/compact 40). A slot freed by 07:03. The worker's branch starts at `e4405056e`, which already holds #376 (box-token row 2c), so README.md's co-edit with bright-river (4458) has no merge left for this run. W1a does not touch `server/src/index.ts`, so the 02:46 consent to #351 there does not bear on it.

- **2026-10-13 02:41 — RUN 399 IS NOT YET DISPATCHED.** CCR-15's run 400 took the first free slot at 02:30. Run 399 was refused `cap-concurrency` (7 of 7) at every try, and the background waiter was stopped at 02:40 by Claude Code for low box memory. I retry once per wake. All overlap consents are already in its brief.

- **2026-10-13 01:24 — W1A'S AND W1B'S PLANS ARE ON MAIN: #377 = `24c9da9fc` (planSha `24c9da9fcda263444191cc8d607e0e3330619dd5`).** Run 399's dispatch waits behind CCR-15's run 400 on the same waiter (`cap-concurrency`, 7 of 7). Consent asked of workspace-lifecycle (mail 4454: `watch.ts`; #351 edits `expireArchived.ts`) and ccrc history (4455: `lifecycle.test.ts`); the brief keeps the worker off those files until I relay each answer.

- **2026-10-12 23:40 — W1A'S AND W1B'S PLANS ARE WRITTEN** (beside CCR-15 wave 10's, by the same process: grounding, an architect/critic/reviser frame, one Opus drafter per task, a sliced two-lens review with Sonnet refuters, and a convergence review).
  - **W1a** (`2026-10-12-path-identity-w1a-server-id-gate.md`, 18 tasks, server only). Rulings beyond the spec, all in the plan:
    - `isRegistryId` sits at the foot of `shared/api.ts`, and `TMPROOT_ID_MAX_CHARS` becomes its derived alias until after #351;
    - a refused id is omitted, never retained, and is logged once;
    - abandon closes a run whose stored id fails the predicate as `failed` with no fleet act;
    - the reclaim door answers `bad-session` for a bad heir or a bad stored claimant;
    - `/ensure` and the cross-pool swap gain a route-head check;
    - `POST /api/runs` also refuses a dash- or dot-leading work-run `project`;
    - `childGateAtClose` is exported for its own pin;
    - stop's pair form refuses a flag-shaped registry field before composing (`stop-pair-fields-refused-at-composition`).
  - **W1b** (`2026-10-12-path-identity-w1b-ccd-id-hardening.md`, 14 tasks, `ccd/ccd`). Rulings beyond the spec:
    - **The composed-id cap is 128** (R27, option a), not the spec's 222. The session hook's peer census skips another session's id longer than 128, so a longer id would lose its place in its peers' counts (its own card is gated on its project, at 64; corrected 2026-10-15 from review 465). Nothing on the fleet comes near it: the longest id is 31. This was reported to the operator and is reversible before W1b dispatches.
    - `enable`'s two-argument form checks its wrapper (cmd_start's own check and words) before any journal line or lock.
    - The collector's pre-lock pass proves its registry listing by measurement.
  - **Carried, owner this ledger:** `abandon-sheet-misreads-an-omitted-fleet-act`, `reclaim-sheet-drops-the-bad-session-detail` (both PWA, placed with the next wave that edits `pwa/`) and `work-run-project-reaches-ws-add-unchecked` (closed by W1b's ws-add loop).

- **2026-10-12 18:53 — WAVE 1 (W1a) IS RUN 399, `planned`.** It was opened at 18:52 beside CCR-15's run 400, before run 380 closed. Its block is 24 numbers, issued by the allocator: 4860, 4861, 4862, 4863, 4864, 4865, 4866, 4867, 4868, 4869, 4870, 4871, 4872, 4873, 4874, 4875, 4876, 4877, 4878, 4879, 4880, 4881, 4882, 4883.

- **2026-10-12 18:51 — THE PROGRAMME OPENS. The operator merged the W0 spec (#360, 18:48:11Z) and wrote "360 merged", naming no exception.**
  - **How I read the merge.** It approves the design with its recommendations. Each row marked Operator takes its recommended option as the working ruling. Each row marked Coordinator stands as proposed. The operator can change any of them before the wave that builds it dispatches; a change after dispatch becomes a fix round.
  - **SECURITY:** SEC1 D (all eight `--session` loops, plus stop and ws-add's loop), SEC2 B (registry readers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams; no builder brand or builder assertion now), SEC3 C (both predicates and loops), SEC4 A (tighten `_ws_project_valid` after a Task 0 re-count), SEC5 C (cap the composed id at 222 at every mint site), SEC6 A (the no-dot-leading entry rule at ws-reclaim and ws-expire), SEC7 A (pure checks before the collect reap lock), SEC8 A (W1a now, W1b after #351).
  - **Temp roots and mounts:** TR1 A, TR2 A, TR3 A, TR4 A, TR5 C, TR6 A, TR7 A, TR8 A, TR9 C, TR10 C, TR11 C (W4 does not run), TR12 B.
  - **Worktree identity:** PI1 B, PI2 L1, PI3 B, PI4 D, PI5 A, PI6 M4, PI7 P1 (P2 where the field is valid), PI8 B2, PI9 K1, PI10 O2.
  - **Programme:** PG1 B (W4 is not scheduled; its residuals stand), PG2 A (workspace-lifecycle's consent per wave, for W2 and W3).
  - **The switch (SW1 to SW7) is CCR-15's wave 10** and is recorded in that ledger.
  - **Sign-in is armed on the server box** (measured 18:5x from anonymous reads: `GET /api/auth/status` answers `mode: "passphrase"`; a protected read without a session answers 401).
  - **The order.** W1a ships first, in parallel with CCR-15's wave 10. W1b waits for #351. W2 and W3 follow in series, because every `ccd/ccd` edit is serial.

## Carried constraints

- **Every `ccd/ccd` edit waits for workspace-lifecycle W6 (#351) to merge, and the ccd waves then go in series** (W1b, W2, W3). W1a and CCR-15's wave 10 edit no `ccd/ccd`.
- **Anything shared with ws-expire needs the consent of workspace-lifecycle's coordinator, per wave** (PG2 A). That covers W2's tail and step 4, and W3's ladder, tail and ws-expire's probe.
- **Review 388's carries:** the wave-9 lane-case title over-claims order (item 38), the contract's Task 5 line counts three indents where there are two (item 39), and `collectBoxProbesAtArrival` says "latest change" at four sites (item 40). Items 38 and 40 ride CCR-15's wave 10 if it touches those files, otherwise W2; item 39 rides the contract section.
- **Comment carries that need a `ccd/ccd` restamp** (items 29 to 31) ride the first wave that restamps `ccd/ccd`, which is W1b. They are worded line-neutrally, because the collector header sits under the frozen citation-corpus anchors.
- **The macOS purge-refused red** (item 37) is a stated residual; reopen it only if it recurs.

## Next-wave brief

**Wave 1 is W1a, run 399, `planned`: the server's id gate.** Its plan is
`docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md`, binding with contract §17 and spec section 2.
It reaches `main` in the same docs PR as CCR-15 wave 10's plan, and the brief names that PR's squash commit as `planSha`.

Before dispatch, re-read `GET /api/claims?project=ccrc-pwa` and record each overlap's agreement in the brief (R56: the
second lander merges `main` and re-points by content): CCR-15 wave 10 (run 400) shares the `shared/api.ts` foot,
`watch.ts`, `coord/routes.ts`, the `single-definition.test.ts` foot and the `mail-routes.test.ts` kebab census;
workspace-lifecycle wave 6 (#351, run 358) edits `coord/expireArchived.ts` and `watch.ts`.

Then dispatch one fresh child. **Route:** `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on',
compact:'40'}`. **Execution skill:** `superpowers:subagent-driven-development`, with
`superpowers:test-driven-development`. **Lenses:** the plan's mandatory SECURITY lens beside the held-out panel.

**Wave 2 is W1b.** Open its run only after #351 merges; allocate its block then. Before dispatch: workspace-lifecycle's
coordinator's consent to its three `ws-expire` edits; the server box's ls-only counts, `max-id-len` included (Task 0).
