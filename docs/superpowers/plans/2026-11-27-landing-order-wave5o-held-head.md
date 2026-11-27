# Landing order, wave 5o — a head that conflicts before it is queued must not hold the line in silence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan dispatches nothing itself: the wave is built by a worker the coordinator dispatches.

**Status:** drafted on 2026-11-27 for run 4081 (programme `landing-order`, the run's wave 35) from the brief's seven decisions. Revised the same day after the coordinator's addendum (call 1758): the conflict send-back covers this run's own pinned entry wherever it stands in the order, and the plan says how such an entry is measured, what the send-back costs, and what the radar already knows. Revised again after review run 4083 (fix round 1, the coordinator's rulings): the notice covers the measured conflict only, and `head-mismatch` gets none; the identity is the brief's; the early send-back is not for a line the operator holds; the cost sentence names three costs; the draft condition names its order; and the decider arm and its transaction are one commit. One build wave and one pull request; section 3 says why it is not split and where the seam would be.

**Goal:** When the head of a project's landing line is held because the radar measured its pinned head conflicting with the base, which only that entry's own coordinator can clear, that coordinator is told once, by the next-to-land cue's own decider and transaction. The coordinator's text gives it the one move the line's vocabulary already has for a pinned entry that conflicts before it is queued: the ejection of kind `conflict`, for its own entry at the head or behind it. The worker's skill knows that mail's first line.

**Architecture:** Two repairs, one per gap of issue #3577.

1. **The notice (D-9159).** `server/src/coord/landingNext.ts#nextLandingNoticeOf` (L1, C5) gains a third answer, `held`. It is given only on a held binding whose reason is `composition-not-clean` with a measured `conflict` for the pinned head. Its recipient comes from the cue's own rule, now one private helper that both answers call. The probe's one head for a PR is read by one exported function in `server/src/coord/landingLine.ts` (L1, C4), which the binding and the notice share. `server/src/coord/landingControlTx.ts#applyLandingControlTx` (L3, C5) queues the answer in the cue's own transaction, through the same two notice bodies. The run arm dedupes on its observation row and the run-less arm on its subject.
2. **The text (D-9160).** The coordinator's step 6 (`ccd/coordinator-skill/references/wave-steps.md`) names a third ejection case. The landing-line paragraph (`wave-lifecycle-5b-landing.md`) names the notice, the one held binding that is no stop (this run's own entry at the head), and the same send-back for this run's own entry behind the head while the operator does not hold the line, with when to measure it and what it costs. The worker's skill (`ccd/worker-skill/SKILL.md`) reads `ejected: conflict:#<pr>` beside the two first lines it knows.

What does not change: the binding still reads only the head, and the server ejects nothing and chooses no successor. There is no new table, route, migration, `ccd` verb, capability word, wire field, binding reason or ejection kind.

**Tech Stack:** TypeScript ESM (server L1 and L3), Vitest, Markdown (the coordinator references, the worker skill, the README). Node >=22.16.0.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.5, specifically "Next to land (P3 and P4; 2026-11-14, item 312; D-8628)" and the coordinator's step 5 ("On a conflict, or a red after one automatic re-run of failed jobs, the coordinator sends the owning worker a `fix-round` mail naming base B"). The case is issue #3577. Ledger: `docs/superpowers/programs/landing-order.md`. Model plan: `docs/superpowers/plans/2026-11-26-landing-order-wave5l-train-landings.md`.

**Source baseline:** `origin/main` at `f80f47760b610cf86887856294cb1b5e9695d2bc`. This plan's author read every present-tense claim about the code below at that commit. The fix round's new facts were read at `origin/main` `87f8aa14497f02357583202b5279b14b45b50fa5`, which differs from the baseline in no file this plan cites, and every text block of sections 7 and 8 was checked at both commits. A builder whose dispatch base is newer re-reads each cited owner before changing it, and says in the task note what moved.

## What was measured

Each fact comes with the command that measured it. Every command ran on 2026-11-27 in a worktree at the baseline. `R=origin/main` throughout.

- **The binding stops at the head, and a conflict there is `composition-not-clean`.** `git grep -n "held('head-mismatch')\|held('composition-not-clean')\|held('main-red')" $R -- server/src/coord/landingLine.ts` answers lines 195 to 197, in this order:
  - `if (probed === null || probed.head !== head.pinnedSha) return held('head-mismatch');`
  - `if (probed.base.state !== 'clean') return held('composition-not-clean');`
  - `if (health.doc.state === 'red' && !head.fixesMain) return held('main-red');`

  `probed` is the probe's one head named for the selected head's PR: `named.length === 1 ? named[0]! : null`. It is computed inline, two lines above. `entryId` of every held answer names the flag-free walk's selected head (`landingBindingOf`'s comment). Nothing in the function looks at a later entry.
- **A held binding sends nothing today.** `git grep -n "if (binding.mode === 'held') return noSend(binding.reason);" $R -- server/src/coord/landingNext.ts` answers line 62. The ready path builds the identity tuple `['landing-next', 1, project, entryId, pr, pinnedSha, handoffCommit, pinnedAt, episode.kind, runIdOrNull, episodeOrCreationSeq, baseSha, toId]` and a body that says "This is not merge permission".
- **The cue's recipient rule is inline in that function.**
  - A run-bound row goes to `run.claimedBy`, only while the run reads the row's own id and project, waits at `merging`, has a claimant and has a current episode whose `pr` and `head` are the row's. Otherwise the no-send reason is `run-unreadable`, `run-not-merging`, `recipient-missing`, `episode-unreadable` or `episode-changed`.
  - A no-run row goes to its journal creation's `setBy`, or the reason is `creation-unrecorded`.
- **The cue's duplicate is refused in two places, one per arm.** `landingControlTx.ts` digests the identity with SHA-256 into the subject `next-to-land:#<pr>:<digest>`.
  - The run arm calls `queueLandingNoticeTx` (`server/src/coord/rundefsTx.ts`) with the detail `landing:next:v1:<digest>`. It refuses through `CoordStore.insertObservation` (`server/src/coord/store.ts`): `SELECT 1 … FROM run_events WHERE runId = ? AND detail = ?` answers `duplicate`, and the `episode` predicate (the run at `merging`, with its newest transition into `merging` being that episode) answers `run-gone`.
  - The run-less arm calls `queueRunlessNoticeTx`, which refuses on `coord.hasMailWithSubject('operator', null, toId, subject)`.
  - `readChecksRowDetail` (`shared/landing.ts`) returns `null` for a detail that does not begin with a checks prefix, so a `landing:…` detail passes the checks-row guard untouched.
- **The probe's composition has three words and the parser keeps each PR once.**
  - `git grep -n "LANDING_MERGE_STATES =" $R -- shared/api.ts` answers line 683: `['clean', 'conflict', 'unmeasured']`.
  - `server/src/coord/radar.ts#ProbeAnswer` carries `paths` and `pathsCut` on `conflict` only.
  - `radar.ts#ProbeHead` is `{ pr, head, branch, id, base }`.
  - `parseProbe` refuses a head that is not 40 hex and a PR listed twice (`byPr.has(e.pr)`).
  - `ccd/ccd-land-probe`'s `merge_answer` writes `unmeasured` on `budget`, `timeout`, `rc-N` or `no-tree`. So `composition-not-clean` covers two different facts: a measured conflict, and a composition the radar could not measure.
- **The probe lists open same-repository pull requests only, drafts included.** `ccd/ccd-land-probe`'s `gh_pr_list` lists with `gh pr list --repo <slug> --state open --base <base>`, and `open_heads` keeps a row only when its `isCrossRepository` is false (`git show $R:ccd/ccd-land-probe | grep -n "isCrossRepository\|if not cross"`). A merged or closed PR is therefore never listed, a draft is, and a pull request from a fork never is.
- **The probe stamps its document at the end of its pass, every five minutes, and the server reads it as fresh for twenty.**
  - In `probe_project` the pass lists the heads first (`open_heads`), then fetches and measures them (`fetch_into_scratch`, `merge_answer`), and only then builds the document, whose `at` is `now_iso()` at that moment (`probe_doc`): `git show $R:ccd/ccd-land-probe | grep -n "def probe_doc\|'at': now_iso()\|open_heads(slug, base_ref)"`. So a document stamped after a pin may hold heads listed before it.
  - `deploy/systemd/ccd-land-probe.timer` has `OnUnitActiveSec=5min`, and `shared/api.ts` has `RADAR_PROBE_FRESH_S = 1200` (`git grep -n "OnUnitActiveSec\|RADAR_PROBE_FRESH_S =" $R -- deploy/systemd/ccd-land-probe.timer shared/api.ts`).
- **What re-pins a head, and what a retreat does when the episode's head is not the pin.** `git show $R:server/src/coord/landingEntry.ts | grep -n "act: 'repin'\|act: 'quarantine'"`:
  - `decideLandingWrite` re-pins only on an advance to `merging` (`landing.kind === 'pin'`, the `repin` act, for an entry `pinned` or `ejected`). Nothing else moves a pin, so a head pushed while its run waits at `merging` stays unpinned until a send-back and the next advance.
  - On a retreat from `merging` whose episode head is not the entry's `pinnedSha`, it answers `{ act: 'quarantine' }` (wave 5f): no ejection, base, count or notice, and the entry displays `unknown` with the `stale-episode-head` marker until a verified re-pin.
  - **A moved pull request head does not reach that arm.** The run's episode head is the `merging-at:` detail of its newest transition row into `merging` (`CoordStore.currentEpisode`), and that detail is written once, at the advance that pins, from the same `landing.head` the store writes as `pinnedSha` (`CoordStore.advanceLanding`: `mergingAtDetail(landing.head, landing.pr, landing.mode)`; its comment says the two "cannot disagree"). A push to the pull request afterwards changes neither: `git show $R:server/src/coord/store.ts | grep -n "mergingAtDetail(landing.head\|currentEpisode(runId: number)"`. So a retreat from `merging` in the episode that pinned the entry reads `current.pinnedSha === f.episode.head` and takes the `eject` act, counted, with the retreat's base and kind, or with neither on a bare retreat; `quarantine` is reached only when the entry's pin is not that episode's head, which this plan did not trace further.
- **A PR that waits on a held line is turned back into a draft by its coordinator after the first read, and the checks lane has left it.**
  - Under D-9115 (`wave-lifecycle-5b-landing.md`, the landing-line paragraph) the coordinator reads the line as soon as the advance to `merging` answers `ok`, and unless that read's `binding` is `ready` for this run's own entry it turns the PR back into a draft with `gh pr ready <pr> --undo` before its turn ends. The PR was marked ready before the advance (`wave-lifecycle-5-boundary.md`), so at that first read it is not a draft yet: `gh pr view <pr> --json isDraft` reads `false` until the `--undo`.
  - `server/src/coord/landing.ts#landingLineAct` answers `left` with phase `draft` for a draft. The checks lane decides its mode once, at the advance (`checksModeAt`).
  - So no `checks:` mail tells the coordinator of a later head move or conflict. The PR was never queued, so no `dequeued:` mail comes either.
  - Nothing in the coordinator's text reads `isDraft` today: the train case reads `gh pr view <pr> --json state,labels`, and the draft is set with `gh pr ready <pr> --undo` (`grep -n "isDraft" ccd/coordinator-skill/references/*.md` answers nothing).
- **The line's vocabulary already has the third ejection, and the advance takes it.**
  - `shared/landingLine.ts` line 33 is `LANDING_EJECTION_KINDS = ['dequeued', 'new-head', 'conflict'] as const`. `git log --format='%h %ad %s' --date=short -S"'new-head', 'conflict'" $R -- shared/landingLine.ts` answers `4fc83e57bd 2026-10-31` (#2020, wave 5e). Every server since wave 5e has had the word.
  - `server/src/coord/advance.ts#advanceRequest` accepts any `isLandingEjectionKind` on a retreat to `working`. The store refuses an ejection on a run not at `merging` (`ejection-not-merging`).
  - `pwa/src/fleet/landingWords.ts#EJECTION_TEXT` words `conflict` as "it conflicts with main".
- **The ejection door does not ask where the entry stands.** `advance.ts#advanceRequest` only shapes the ejection: a retreat to `working`, a 40-hex `base`, a known `kind`. `landingEntry.ts#decideLandingWrite` ejects the run's own entry on any retreat from `merging` whose episode head equals the entry's `pinnedSha`. The store refuses only a run not at `merging` (`ejection-not-merging`). The coordinator reports the case live: on 2026-11-27 a second coordinator sent its own entry, then fourth in the order, back with kind `conflict` after its own probe against `main` exited 1 on a draft PR that was never queued. The advance answered `ok`, and the entry reads `ejected` with that base and `ejections` 1 (call 1758).
- **A send-back costs the entry its place.**
  - `CoordStore.advanceLanding`'s re-pin arm (`server/src/coord/store.ts`, the `decision.act === 'repin'` branch) runs `UPDATE landing_entries SET pinnedSha = ?, handoffCommit = ?, runId = ?, state = ?, baseSha = NULL, ejectionKind = NULL, quarantineKind = NULL, detail = NULL, pinnedAt = ? WHERE id = ?` with `Date.now()`. `afterIds`, `fixesMain` and `ejections` are not in it, so they are kept.
  - `landingLine.ts#landingOrder` orders the line by `byKey`: `fixesMain` first, then the earlier `pinnedAt`, then the lower PR number; after edges hold an entry behind an outstanding target.
  - So an entry that comes back to `merging` re-enters behind every entry already in the line, unless `fixesMain` or an order edge places it otherwise.
  - While it is `ejected` it is not in the line but is outstanding (`landingOrder`'s `outstanding` set), so an entry with an after edge to it waits.
  - Every send-back is an ejection to `decideLandingWrite` (its `eject` act counts `ejections` up by one), and the second ejection of one entry raises one operator notice, never a refusal: `landingLine.ts#landingEjectionAsk` titles it `Landing: <project> #<pr> ejected twice` when `ejections` reaches `LANDING_EJECTION_ASK_AT`, and `server/src/coord/routes.ts#@landing-ejection-ask` raises it. Step 6 already tells a coordinator to name a second ejection in its turn's text.
- **Nothing in the coordinator's text sets a timer while a run waits at `merging`.** `grep -n -i timer ccd/coordinator-skill/references/wave-steps.md` answers nothing. In `wave-lifecycle-5b-landing.md` the one timer is the 20-minute re-read on a held head that is another run's train-closed PR (line 537). `references/api.md`'s **Timers** paragraph says how a timer is bound to a run or a programme, not when to set one. The coordinator's waits at `merging` are woken by mail: the advance's own answer, a next-to-land cue, a `checks:`, `dequeued:` or `merged:` mail, and any mail that names the run.
- **The radar already measures every open PR, not only the head.**
  - `ccd/ccd-land-probe` writes one `heads` element per open PR on the base (up to its cut, `headsCut`), each with `base`, its composition with that base sha (`merge_answer`).
  - The server reads that document in two places:
    - the radar lane (`server/src/watch.ts`, the pass that calls `readRadarPass`) hands it to `applyLandingControl` as `control.probe`, where only the selected head's element is read (`landingBindingOf`);
    - `radar.ts#sessionLandingsOf` derives `FleetSession.landing` for each fleet session whose current PR the probe lists, with `base` among its fields. That is the console's predicted-conflict chip (wave 4b).
  - So a pinned entry behind the head that conflicts with `main` is already measured, every radar pass, by the producer the notice reads. Section "What this does not claim" says what the decider would need to use it.
- **The coordinator's text names two ejections only.** `wave-steps.md` lines 159 to 192, inside step 6's **Send back:** bullet, read: "**An ejection** is sent in two cases only: the new-head route … and a dequeue (§5) whose cause is a conflict you measured". The mail's first line is "`ejected: new-head:#<pr>` or `ejected: dequeued:#<pr>`", and the advance's `kind` is "`new-head` or `dequeued`".
- **The landing-line paragraph gives every held binding one answer.** `wave-lifecycle-5b-landing.md` line 519: "a `held` binding … means stop and report what you read to the operator; never choose a successor". Line 544: "A `held` binding, `opt-in-unknown` included, stops."
- **The worker's skill names two ejection first lines.** `grep -n 'ejected: ' ccd/worker-skill/SKILL.md` answers lines 387 to 391: `ejected: dequeued:#<pr>` and `ejected: new-head:#<pr>`.
- **The worker's skill cannot grow.**
  - `wc -c ccd/worker-skill/SKILL.md` answers 35535, and `server/test/skill-size-caps.json` caps the file at 35559.
  - `server/test/skill-size-ratchet.test.ts`'s rule R5 refuses any growth against the merge-base beyond the bytes of the clause lines a branch appends. This wave appends none, so the file's new text must be the same size or smaller.
  - A size under the cap only prints a "lower its entry" line. It never fails (`judge`'s `lowered`).
- **The subject word `landing-held` is taken, and `head-held` is free.**
  - `git grep -n "'landing-held'" $R -- server/src` answers `landingWrites.ts` lines 420 and 444 and `landingDoorsTx.ts` line 69. That word is the operator's withdrawal notice to a dependant (wave 5j, D-9050), with subject `landing-held:#<pr>:<digest>`.
  - `git grep -c 'head-held' $R -- .` answers nothing.
- **Nothing in code reads a cue's subject.** `git grep -n 'next-to-land' $R -- server/src shared ccd pwa/src` answers the writer (`landingControlTx.ts` line 54), comments, and one sentence of `wave-lifecycle-5b-landing.md` (line 549). No PWA, feed, digest or hook reader exists. The README mentions the mail once (its line 6020).
- **The census of quoted kebab tokens.** `server/test/mail-routes.test.ts`, the case "every quoted kebab token in server/src/coord that looks like a code is declared", scans every `server/src/coord/*.ts` file for `'[a-z]+(-[a-z]+)+'`.
  - Every such token must be in `NOT_CODES` or one of the vocabularies' guards. The landing words of wave 5i sit in `NOT_CODES`, one commented line each.
  - `composition-not-clean` and `head-mismatch` are there already. A new quoted kebab token in `landingNext.ts` or `landingControlTx.ts` needs a row. A template string such as `` `head-held:#${pr}` `` does not match.
- **The pins on the text** (`server/test/coordinator-skill.test.ts` and `server/test/worker-skill.test.ts`, read at the baseline).
  - `coordinator-skill.test.ts`, describe "landing order wave 5b: the report-less fix round from merging":
    - the case "sends a fix round with no report from merging in one of two forms …" (`toContain` of each sentence);
    - "names the report-less first lines the worker skill reads …" (a loop over the three first lines, in step 6 and in the worker's skill);
    - "no report-less sentence holds a double quote" (ten openers);
    - the whole-paragraph `REPORT_LESS` pin "pins step 6's report-less paragraph whole …";
    - "records the base on the ejecting advance …" (a loop over `['new-head', 'dequeued']`, each in `LANDING_EJECTION_KINDS` and in step 6).
  - The same file's 5f describe holds:
    - a second whole pin, "pins step 6's whole report-less paragraph with the entry's base …";
    - the physical-line pin "step 6 replaces its physical lines once …" (`STEP6_AFTER`, four physical lines of `wave-steps.md`, which must still occur once, each at most 80 columns).
  - Describe "landing order wave 5e: the landing line read before every landing" holds:
    - the whole `LINE` pin, "pins the whole landing-line paragraph …";
    - "no 5e sentence holds a double quote".
  - `worker-skill.test.ts`:
    - "reads a fix-round mail with no report in its two forms …" (`toContain`);
    - "pins the whole fix-round bullet, from its heading to the end of the file …" (whole);
    - "carries all twenty clauses verbatim".

  The stop paragraph's pins ("pins the whole stop paragraph …", "says what a stop does …") are not touched by this plan (section 7.2 says why).
- **Who else reads these texts** (corrected after review 4083, F7).
  - **The two skill references and the worker's skill.** `grep -rlE "wave-steps\.md|wave-lifecycle-5b-landing|waveLifecycleText" server/test` and `grep -rlE "worker-skill/SKILL\.md" server/test` list, beside the two pin files: `ccrc-api-closed`, `child-reclaim-refusals`, `coordinator-approval-prompts`, `coordinator-landing-verdict`, `coordinator-skill-autonomy`, `expiry-lane-prose`, `mail-inbox-skills`, `overlord-skill`, `session-hook-merge-deny`, `wrapper-roster-fixture`, `conflict-sync-text`, `session-hook`, `session-hook-role-skill-deny`, `ci-trace-run` and `skill-size-ratchet`.
  - **The suites that scan whole skill trees**, which that pattern misses, measured by reading each file's reads (`git show $R:server/test/<name>.test.ts | grep -n "readdirSync\|ls-files\|coordinator-skill\|worker-skill"`): `dead-coordinator-prose`, `ws-collect-prose`, `ws-expire-prose`, `ws-shed-deps-prose` and `child-reclaim-prose` (each walks the skill directories), `workflow-control-census` (every tracked file under the coordinator skill), `install-worker-skill` and `ccd-skill-ensure` (they copy the worker's tree), and `update-branch-absent` (it scans tracked skill text for a banned verb).
  - **The installers' suites**, which copy the trees: `install-coordinator-skill`, `install-graphify-skill`, `ccrc-install-landing`, `ccrc-install-graphify` and `ccrc-uninstall`.
  - **Not readers:** `resume-reclaim-l0` reads only `references/resume.md`, and `routing-references` only `references/routing-matrix.md` and `references/review-panel.md`; an earlier pattern matched them by path shape.
  - **The README's readers**, measured by `git grep -n -E "(join|resolve)\([^)]*'README\.md'\)|readFileSync\([^)]*README|read\('README\.md'\)|flat\('README\.md'\)" $R -- server/test` less the hits that write a fixture repository's README (every `ccd-*` file, `delegation-rig`, `release-main`, `release-stable` and `testbox-transport`): `box-token-census`, `ccrc-doctor-session-path`, `ccrc-install-graphify`, `ccrc-settings-census`, `ccrc-update-fetch`, `child-reclaim-prose`, `collect-lane-prose`, `collect-switch-prose`, `conflict-sync-text`, `coordinator-skill`, `crossrepo-prose`, `dead-coordinator-prose`, `expiry-lane-prose`, `history-cli`, `history-lib`, `history-replay`, `history-skill`, `install-session-hooks`, `license`, `mail-inbox-skills`, `overlord-skill`, `pools-prose`, `privacy-journal-census`, `readme-holds`, `readme-roster-mirror`, `session-hook`, `session-hook-steer`, `stall-settings-prose` and `stall-settings-readme`, plus `ccrc-settings-verb`, which builds the path with `path.dirname` and that pattern misses; and the tracked-tree scanners `topology-clean`, `workflow-control-census`, `anchors` and `citations`. None pins the paragraph this plan edits (`git grep -n "main-red hold has one writer\|next-to-land mail" $R -- server/test` answers only the skill sentence "A next-to-land mail restarts this read …"), and the README is in no size cap (`skill-size-caps.json`) or growth list.
  - **Load-sensitive, run alone:** `typecheck-tests`, `session-hook`, `session-hook-merge-deny` and `session-hook-role-skill-deny` (root `CLAUDE.md`'s known load flakes and their siblings), and `landing-next-mail`, which runs a real store per case.
- **Claims on files this wave edits** (`ccrc-api claims list --project ccrc-pwa`, 2026-11-27):
  - `README.md` and `server/test/mail-routes.test.ts` were each held by another run's claim. A claim id expires, so the builder reads the claims when the build starts and sends each file's packet to the session that holds its claim then;
  - run 4073, another programme's, is changing the console's landing block under `pwa/`. This plan edits nothing under `pwa/` or `ui/`.
- **`CLAUDE.md` says nothing about the cue.** `grep -n -i 'next-to-land\|held-head' CLAUDE.md` answers nothing. It gains no line (section 8).
- **The text below was applied and checked before it was written here.** A scratch script applied every old and new block of sections 7 and 8 to copies of the four files at the baseline and again at `87f8aa1449`, with the same results. It checked that each old text occurs once and each new one once after the change, and that `STEP6_AFTER` still occurs once. It measured the sizes:
  - `wave-steps.md` 21328 to 21842 bytes;
  - `wave-lifecycle-5b-landing.md` 46964 to 49851 bytes;
  - `ccd/worker-skill/SKILL.md` 35535 to 35522 bytes (−13);
  - `README.md` 849900 to 850168 bytes (+268).
- **Exactly one existing case pins today's silence on a measured conflict.** A scratch build of sections 5.1 to 5.6 was made in an export of `main` under the session's temp root (`git archive origin/main server shared ccd deploy agent CLAUDE.md README.md | tar -x -C <scratch>`), and the existing suites were run against it unchanged:
  - `landing-next-mail.test.ts`: 1 failed, 48 passed (49). The red case is the store `it.each` row "a selected head whose composition conflicts with the base: through the store, no cue is queued (zero mail, deliveries and observations), twice over" in the describe "applyLandingControl: an unhealthy selected head holds the line, and a later clean entry queues nothing (M12)": `expected { kind, mailId, … } to deeply equal { kind: 'no-send', … }`. Its two `head-mismatch` rows, the binding `it.each` over all three rows, "a head that leaves and returns without a new pin or base mints no new episode" and M21's "a head changed after evidence collection sends nothing" stay green, because the notice no longer covers `head-mismatch`.
  - Green unchanged: `landing-control` (63), `landing-terminal-damage` (64), `landing-read-route` (32), `landing-entry-census` (40), `radar-lane` (78), `landing-ejection-ask` (8), `landing-advance-route` (35), `landing-writes-route` (36) and `landing-doors-route` (15).
- **The store cases run on one fixed clock.** The file's `apply` helper passes `nowMs: CONTROL_NOW` on every call, after `reopen()` too. Measured on the scratch build: a mutant whose run-arm detail carries `nowMs` stays green when the duplicate's second call uses that clock, and goes red when it uses `CONTROL_NOW + 60_000`; the same holds for a run-less subject that carries `nowMs`.

  The flattened sentences that section 7.4 gives the pins are that script's output.

## 1. Decisions

The brief's seven decisions, as this plan keeps them.

1. **A notice, from the cue's own decider (D-9159).**
   - `nextLandingNoticeOf` answers `held` on the held bindings of decision 2. It finds the recipient by the cue's own rule, which this wave moves into one private helper (`episodeOf`, section 5.4) so that the two answers cannot drift apart.
   - `applyLandingControlTx` queues the answer in the same transaction, through the same two notice bodies.
   - It is sent once per identity. The identity is the brief's: the entry, its pin, the run or creation episode, the base and the recipient (section 5.5). It survives a restart as the cue does, because both dedupes are durable rows.
   - Its body says what was read and what to measure, and that it is not an instruction to eject.
   - No second decider, lane, poller or table. `landingLine.ts` gains one exported reader of the probe's head for a PR (`probedHeadOf`), which the binding already computes inline. The binding now calls it, so the head is found by one rule in both places.
   - **The bound** (the coordinator's ruling on question 2): while the conflict stands, one mail per move of `main` (a new base), one per new pin (the run went back and came again) and one per new recipient (a claimant change), and no other.
2. **Which reasons** (section 2 goes through all eleven words).
   - **In:** `composition-not-clean` when the probe's answer for the pinned head is `conflict`. An `unmeasured` composition is the radar's, and time clears it: no notice.
   - **Out, by the coordinator's ruling (review 4083, F3):** `head-mismatch` when the probe lists the PR at a head other than the pin. Two reasons (a third, that a send-back would meet the stale-head quarantine, was withdrawn by the coordinator's correction and is false as measured: a send-back there is an ordinary ejection, "What was measured"):
     - the probe stamps its document at the end of its pass, after it listed the heads ("What was measured"), so a stamp later than the pin does not prove the heads were read after it: a pin or re-pin of a head pushed in the five minutes before reads `head-mismatch` against a probe that is fresh and older than the head;
     - the text gives that binding no remedy but a report to the operator;
   - **Out:** `head-mismatch` when the probe does not list the PR. Since wave 5l that leaves a PR merged or closed that the landed reader has not marked yet (time clears it; a merge also sends the `merged:` mail), a PR whose base is not the probe's, and a pull request from a fork, which the probe never lists. The line does not support the last two (section "What this does not claim").
   - Every other reason is the operator's or time's and gets no notice.
   - **When the reason clears and returns:** on the same base, pin, episode and recipient there is no second mail, as with the cue's A→B→A rule. On a new base (`main` moved), a new pin (the run went back and came again) or a new recipient, one new mail.
3. **The server ejects nothing and chooses no successor.** The binding still reads only the head. The notice is a cue to read the line, and the entry's coordinator decides.
4. **The third ejection form, in the text (D-9160; amended by the coordinator's call 1758).** It is for this run's own pinned entry wherever it stands in the order, on a conflict this coordinator measured itself. Section 7 gives every old and new text word for word, each old text checked to occur once.
   - **Step 6:** an ejection is sent in three cases. The third is a conflict this coordinator measured on this run's own pinned entry before the PR was queued, at the head of the line or behind it. Its first line is `ejected: conflict:#<pr>` and its three lines are those of a dequeue, the same in both positions. It differs from a dequeue in two places only: the probe reads the entry's `pinnedSha`, and there is nothing to disarm because the PR was never queued, and §5b measures it only once the `--undo` has made it a draft (D-9115). The advance's `kind` takes `conflict`.
   - **The landing-line paragraph, at the head:** it names the notice, and takes one exception to "a `held` binding means stop and report". The exception holds when all of these do:
     - the binding is held with reason `composition-not-clean`;
     - its `entryId` names this run's own entry, `pinned` at the head you bind;
     - the PR is a draft, measured in this order (review 4083, F4): first turn it back into a draft with `gh pr ready <pr> --undo`, as D-9115 already says for every read whose binding is not `ready` for this run's entry, then `gh pr view <pr> --json isDraft` reads `true`;
     - this coordinator's own probe exits 1 with a tree id on its first line.
   - **Behind the head:** there is no binding to read, because the binding reads only the head. The trigger is the measured conflict alone: this run's own entry, `pinned` at the head you bind, not the entry `binding.entryId` names, a draft PR in the same order, and the same probe exiting 1. It is allowed because such an entry cannot land, so waiting only moves the hold to the moment it reaches the head.
     - **Not while the operator holds the line** (the coordinator's ruling, the report's R4): the early send-back is not for a read whose binding is held with `paused` or `recovery`. Those are the operator's holds, and the operator decides what moves while one stands.
   - **When to measure behind the head, with no polling.** Only on a read of the line the coordinator's text already makes for this run, once on that read, and never on a loop or a timer of its own. The reads are named: the one after the advance to `merging` (D-9115), a next-to-land or `head-held:` mail, and the 20-minute re-read when the held head is another run's train-closed PR (review 4083, F11).
     - **This departs from the words the addendum proposed.** The proposal was "or on the one timer it already sets while a run waits at `merging`", and no such timer exists ("What was measured": the only timer in the landing text is the 20-minute re-read on another run's train-closed head). The text names that timer among the reads, and adds none.
   - **What it costs, all three** (the coordinator's ruling on F12):
     - the entry's place: the advance that brings the run back re-pins the entry with a new `pinnedAt` (the store's re-pin arm), so it re-enters behind every entry already in the line unless `fixesMain` or an order edge places it otherwise, and both are kept;
     - a second send-back of one entry raises the server's one operator notice for an entry ejected twice (`landingEjectionAsk`), which step 6 already tells the coordinator to name;
     - every entry with an order edge after it waits while it is out, because an ejected entry is still outstanding.
   - **The closing sentence:** nothing else licenses the send-back. Not another run's entry, not an entry whose conflict this session did not measure with that probe, not another reason (`head-mismatch` by name), not a ready or queued PR, and not a probe that exits 0 or answers anything else. "Every other `held` binding … stops" ends the paragraph's held rule.
   - **The worker's skill:** it takes the third first line beside the two it names. The whole bullet stays at or under its size, because two redundant phrases go (section 7.3).
   - No numbered clause of either `SKILL.md` changes. The coordinator's clause 15 already speaks of "an ejection naming the base sha the landing line recorded", and the worker's clause 16 of "a `fix-round` mail from the coordinator names this PR ejected from the landing line with a base sha". Both are true of the third kind as written.
5. **One pull request** (section 3). The landing-line paragraph names the notice, so the text documents the server change. A seam exists and is given.
6. **Rollout, both orders** (section 6). Neither order is unsafe.
7. **README and `CLAUDE.md`** (section 8). The README gains one sentence beside the cue's; the builder first sends a packet to the session that holds the README's claim when the build starts (read the claims then). `CLAUDE.md` does not change.

## 2. The binding reasons, one by one

Each word of `shared/landingLine.ts#LandingBindingReason`. "Told today" means whether any mail tells the head entry's own coordinator of it at the baseline.

| Reason | What it means (`landingBindingOf`) | Who can clear it | Told today | Notice |
|---|---|---|---|---|
| `opt-in-unknown` | the lander marker is unreadable, stale or foreign, or no control was measured | time (the next radar pass) or the operator (the fleet box's radar) | no | no |
| `paused` | the operator paused the line (wave 5j) | the operator | no (the operator's own act) | no |
| `recovery` | an authority subject is unresolved (wave 5f) | the operator, by repair; replay | no | no |
| `projection-unreadable` | an open row's projection, state or dependencies do not read | the operator, or the bounded terminal repair | no | no |
| `empty-or-blocked` | no head: the line is empty, or every entry waits on an outstanding target | whoever re-pins or re-declares the order; there is no head entry to tell | the withdrawal's `landing-held:` notice tells the dependants of a withdrawn entry (D-9050) | no (no head entry) |
| `probe-unmeasured` | the probe is absent, stale, foreign or cut (`headsCut`) | time, or the operator for a cut | no | no |
| `health-unmeasured` | main's health is absent, stale, foreign, unmeasured or has no sha | time | no | no |
| `base-mismatch` | health and probe measured different `main` shas | time (the next coherent pass) | no | no |
| `head-mismatch`, PR listed at another head | the PR's head moved since the pin, or the probe listed its heads before a pin of a head pushed in the five minutes before (the probe stamps at the end of its pass) | the entry's run: a send-back and a new advance re-pin it; the next probe for a probe older than the pin; the operator can withdraw the entry | no (the checks lane left at the draft) | no: the evidence cannot tell a moved head from an older probe, and the text's only answer is a report (decision 2) |
| `head-mismatch`, PR not listed | merged, or closed (wave 5l's train case among them), not yet marked; a base that is not the probe's; or a pull request from a fork, which the probe never lists | time: the landed reader marks it; the operator for another base or a fork's entry | a merge: the `merged:` mail; a train landing: wave 5l's re-read rule | no |
| `composition-not-clean`, `conflict` | the radar measured the pinned head conflicting with the base | the entry's coordinator: the ejection of kind `conflict` (D-9160) | **no** (issue #3577) | **yes** |
| `composition-not-clean`, `unmeasured` | the radar could not measure the composition | time | no | no |
| `main-red` | main is red and the head does not fix it | whoever fixes main; time | no | no |

**An entry behind the head** has no binding reason at all: the binding reads only the head, whatever stands behind it. A pinned entry there that conflicts with `main` holds nothing yet, but cannot land, and it will hold the line with `composition-not-clean` the moment it reaches the head. Its own coordinator clears it with the same send-back (decision 4). Nothing tells that coordinator today, and this wave's notice does not either (decision 1 stays head-only; "What this does not claim" says what the radar already knows).

## 3. One pull request, and the seam if it is split

One build wave, one pull request, one context of building (one builder's session can hold it; the files are in two bounded contexts, C4 and C5, as section 4 says).

- **The server half** is one exported function moved out of an inline expression (Task 1), then the recipient helper moved and the decider arm with its transaction branch (Task 2: a move commit, then one commit for the behaviour change, so no commit in between is broken).
- **The text half** is three paragraphs with their pins (Task 3), plus one README sentence (Task 4).

The text names the notice (section 7.2's first new sentence), so as one pull request the text and the code it describes land together, as wave 5l's did.

**If the coordinator rules a split, the seam** is between Tasks 1 and 2 plus Task 4 (server and README; deploy class `server`) and Task 3 (skills; deploy class `skills`). Each half lands green alone: no test of one reads the other's code, since the pure and store cases feed facts and the pins read Markdown.

- **The text half alone** is safe on an old server. The exception sentence does not depend on the notice, and the notice's sentence then describes a mail that never comes, which licenses nothing.
- **The server half alone** is safe beside old text. Section 6 says what an old coordinator does with the mail.

Splitting keeps the rules files apart, which the review judge asks for. Merging keeps one PR the reviewer can read end to end.

## 4. File responsibilities

| File | Ring, context | Change | Task |
|---|---|---|---|
| `server/src/coord/landingLine.ts` | L1, C4 | export `probedHeadOf(doc, pr)` (section 5.1); `landingBindingOf` calls it in place of its inline `named` lookup, with no other change | 1 |
| `server/test/landing-control.test.ts` | test | one pure case for `probedHeadOf`; the existing binding cases stay as they are and must stay green (they pin the move) | 1 |
| `server/src/coord/landingNext.ts` | L1, C5 | the private `episodeOf` (the move commit); then the `held` answer, `LandingHeldNoticeReason`, the private `heldOf`, the header comment and the `LandingControlApplyResult` arm `held-queued` | 2 |
| `server/src/coord/landingControlTx.ts` | L3, C5 | queue a `held` answer with subject `head-held:#<pr>:<digest>` and detail `landing:head-held:v1:<digest>`, through one local queue function both answers use; the header comment | 2 |
| `server/test/landing-next-mail.test.ts` | test | the pure cases H1 to H9, the store cases S1 to S9 (section 9), and the one existing case whose expectation changes (section 9, "The existing case that changes") | 2 |
| `server/test/mail-routes.test.ts` (another run's claim; packet first) | test | two `NOT_CODES` rows: `'landing-head-held'` and `'held-queued'` | 2 |
| `ccd/coordinator-skill/references/wave-steps.md` | skill text | step 6's report-less paragraph (section 7.1) | 3 |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | skill text | the landing-line paragraph (section 7.2) | 3 |
| `ccd/worker-skill/SKILL.md` | skill text | the fix-round bullet (section 7.3), not a numbered clause | 3 |
| `server/test/coordinator-skill.test.ts` | test | the pins of section 7.4, and one new case | 3 |
| `server/test/worker-skill.test.ts` | test | the two pins of section 7.4 | 3 |
| `README.md` (another run's claim; packet first) | docs | one sentence (section 8) | 4 |
| `docs/superpowers/programs/landing-order/wave5o-task-<n>.md` (new) | task notes | one per task | 1 to 5 |

**Not changed:**
- no file in `shared/`;
- `server/src/coord/store.ts`, `rundefsTx.ts`, `radar.ts`, `advance.ts` and `server/src/watch.ts`;
- `ccd/ccd`, `ccd/ccd-land-probe`, either `SKILL.md`'s numbered clauses, `server/test/skill-size-caps.json`, and anything under `pwa/` or `ui/`.

The store's growth-checked file stays untouched. `landingNext.ts` and `landingControlTx.ts` are not in `GROWTH_FILES`.

## 5. Interfaces

### 5.1 The probe's one head (Task 1, `landingLine.ts`)

```ts
import type { LandingControlRead, ProbeDoc, ProbeHead } from './radar.js';   // type-only: no ring edge

/** The probe's one head for `pr`, or null when it lists that PR not exactly once (wave 5o, D-9159): the binding's rule,
 *  shared with the held-head notice so that both read the same head. `parseProbe` already refuses a PR listed twice. */
export function probedHeadOf(doc: ProbeDoc, pr: number): ProbeHead | null {
  const named = doc.heads.filter((h) => h.pr === pr);
  return named.length === 1 ? named[0]! : null;
}
```

In `landingBindingOf`, the two lines `const named = probe.doc.heads.filter((h) => h.pr === head.pr);` and `const probed = named.length === 1 ? named[0]! : null;` become `const probed = probedHeadOf(probe.doc, head.pr);`. Nothing else in the function moves. This is a move under characterization: the existing binding cases in `landing-control.test.ts` and `landing-next-mail.test.ts` are green before and after, unchanged.

### 5.2 The notice's types (Task 2, `landingNext.ts`)

```ts
import type { LandingEntry } from '../../../shared/landingLine.js';  // joins the existing type import of that file
import { landingBindingOf, probedHeadOf } from './landingLine.js';  // the existing value import, widened by one name

/** The one held reason the head entry's own coordinator alone can clear (D-9159): a measured conflict of its pinned head
 *  with the base. Every other reason, `head-mismatch` included, is the operator's or time's, and sends nothing. */
export type LandingHeldNoticeReason = Extract<LandingBindingReason, 'composition-not-clean'>;

export type NextLandingNotice =
  | { kind: 'no-send'; reason: NextLandingNoSendReason }
  | { kind: 'send'; /* unchanged: the next-to-land cue */ entryId: number; pr: number; runId: number | null; toId: string;
      episode: NextLandingEpisode; identity: string; body: string }
  | { kind: 'held'; entryId: number; pr: number; runId: number | null; toId: string; episode: NextLandingEpisode;
      reason: LandingHeldNoticeReason; baseSha: string;
      /** The canonical JSON tuple, not a digest: the L3 caller digests it into the subject. */
      identity: string; body: string };

export type LandingControlApplyResult =
  | { kind: 'no-send'; reason: NextLandingNoSendReason; holdChanged: boolean }
  | { kind: 'duplicate'; holdChanged: boolean }
  | { kind: 'queued'; mailId: number; deliveryId: number; holdChanged: boolean }
  | { kind: 'held-queued'; mailId: number; deliveryId: number; holdChanged: boolean }
  | { kind: 'failure'; failure: LandingInfrastructureFailure };
```

- `NextLandingNoSendReason` is unchanged. A held binding the notice does not cover answers its own binding word as today. A covered one whose recipient cannot be named answers the recipient's word, exactly as the cue does.
- `duplicate` is shared by both answers. `watch.ts` reads only `failure`, so it needs no change.
- `nextLandingRunId` is unchanged. It already reads `binding.entryId` for a held binding, so the transaction reads the head's run before it asks the decider.

### 5.3 The eligibility rule (Task 2, private to `landingNext.ts`)

One arm, by the coordinator's ruling on F3:

```ts
/** D-9159's one rule: the held binding the head entry's own coordinator alone can clear, a conflict the radar measured
 *  between its pinned head and the base, read from the probe's one head for it. */
function heldOf(reason: LandingBindingReason, entry: LandingEntry, control: LandingControlRead):
  { reason: LandingHeldNoticeReason; baseSha: string } | null {
  if (reason !== 'composition-not-clean' || !control.probe.ok) return null;
  const probed = probedHeadOf(control.probe.doc, entry.pr);
  return probed !== null && probed.base.state === 'conflict' ? { reason, baseSha: control.probe.doc.baseSha } : null;
}
```

- The reason test comes first, so no other reason reads the probe. Dropping it is row M6: a `head-mismatch` whose PR is listed at another head with a `conflict` answer would then send (H3).
- The arm does not test `probed.head === entry.pinnedSha`. `landingBindingOf` answers `composition-not-clean` only after its head check passed on the same probe, so that test would be an equivalent mutant.
- `control.probe.ok` and `probed !== null` always hold at this reason, for the same reason. They are there for the type narrowing, and a mutant of either is equivalent.
- The base is the probe's `baseSha`. This reason is reached only after `base-mismatch` passed, so it equals the health document's sha.

### 5.4 The recipient (Task 2, private to `landingNext.ts`)

The cue's inline block moves into one helper, word for word, and both answers call it:

```ts
/** The cue's recipient rule (wave 5i), shared with the held-head notice (wave 5o): a run row's current claimant while its
 *  run waits at `merging` in the pinned episode, or a no-run row's journal creation claimant. */
function episodeOf(entry: LandingEntry, facts: LandingMutationFacts, run: NextLandingFacts['run']):
  NextLandingEpisode | NextLandingNoSendReason { /* the existing block, returning the word where it returned noSend(word) */ }
```

`nextLandingNoticeOf`'s flow afterwards:

1. `inert` answers `no-send` `inert`.
2. A held binding:
   - find the entry whose `id` is `binding.entryId`;
   - `heldOf(binding.reason, entry, control)`, and when it is null (or no entry) answer `no-send` with the binding's own reason;
   - otherwise `episodeOf`, and when it answers a word, `no-send` with it;
   - otherwise the `held` answer.
3. A ready binding is today's path, with `episodeOf` in place of the inline block. Its answer, identity and body are unchanged byte for byte.

### 5.5 Identity, subject, detail and body (Task 2)

**Identity** (a JSON array, built in `landingNext.ts`): the brief's members, the entry, its pin, the episode, the base and the recipient, in the cue's own order under the new tag. In prose this plan writes it `['landing-head-held', 1, project, entryId, pr, pinnedSha, handoffCommit, pinnedAt, episode.kind, runIdOrNull, episodeOrCreationSeq, baseSha, toId]`; the code is:

```ts
JSON.stringify(['landing-head-held', 1, entry.project, entry.id, entry.pr, entry.pinnedSha, entry.handoffCommit, entry.pinnedAt,
  episode.kind, episode.kind === 'run' ? episode.runId : null, episode.kind === 'run' ? episode.episode : episode.creationSeq,
  held.baseSha, episode.toId])
```

It carries neither the reason nor the head the probe read: with one arm both are fixed by the binding (the reason is `composition-not-clean`, and the probed head is the pin). **The bound:** while the conflict stands, one mail per move of `main`, one per new pin and one per new recipient.

**Subject:** `head-held:#<pr>:<64 hex of SHA-256(identity)>`, at most 85 bytes for a PR number of up to 9 digits, well under the 200-byte subject cap. **Detail** (run arm): `landing:head-held:v1:<digest>`. Both are built in `landingControlTx.ts`, where the cue's are.

**Body** (built in `landingNext.ts`; paragraphs joined by a blank line, as the cue's are):

- First: `` `Held head for ${project} #${pr}, entry ${entryId}: the landing line's binding is held at its head with reason composition-not-clean. The conflict radar measured the pinned head ${pinnedSha} as conflicting with base ${baseSha}.` ``
- Then: `'This is a cue to read the landing line again and measure what it names yourself, not an instruction to eject. Act only as the coordinator\'s landing reference says (its paragraph The landing line). Do not select another entry, bind a different head or send back another run\'s entry.'`
- Then `` `Notice identity (the canonical tuple, for diagnosis):\n${identity}` ``.

**Where a duplicate is refused:**
- The run arm, `queueLandingNoticeTx`: `insertObservation`'s `(runId, detail)` check answers `duplicate`, and its `episode` predicate answers `run-gone`, which the transaction maps to `no-send` `episode-changed` as the cue's does.
- The run-less arm, `queueRunlessNoticeTx`: `hasMailWithSubject('operator', null, toId, subject)`.

Delivery, acknowledgement, parking and a restart re-arm neither.

### 5.6 The transaction (Task 2, `landingControlTx.ts`)

After `const out = nextLandingNoticeOf(…)`, a `no-send` returns as today. For `send` and `held`:
- one local function digests the identity and queues through the run arm or the run-less arm, as the cue's body does today;
- the subject and the detail are template literals built in that function from the answer's kind: `` `next-to-land:#${pr}:${digest}` `` and `` `landing:next:v1:${digest}` `` for `send`, `` `head-held:#${pr}:${digest}` `` and `` `landing:head-held:v1:${digest}` `` for `held`. They are never quoted strings: a quoted `'head-held'` or `'next-to-land'` in `server/src/coord/*.ts` would need a census row of its own;
- `queued` answers `queued` for `send` and `held-queued` for `held`, and the `run-gone` and `duplicate` mappings are shared.

No second copy of the queue code. The invariant throw for a run episode without a run row stays, worded for both. The only new quoted kebab tokens in `server/src/coord` are `'landing-head-held'` and `'held-queued'` (Task 2's two census rows).

### 5.7 What does not change

- `landingBindingOf`'s answer, its precedence and its wire shape (`LandingBinding`).
- `mainRedNext` and the flag's one writer.
- The cue's identity, subject, detail, body and once-only rule.
- The advance, `LANDING_EJECTION_KINDS`, the store, the read route and the console.

## 6. Rollout: both orders

The text ships with the skills (deploy class `skills`, every home through the install spine), the notice with the server.

| Pair | What a coordinator reads and does | Safe? |
|---|---|---|
| new server, old skills | It receives a `head-held:` mail. Its text knows no such mail: it reads the line, sees `held`, and stops and reports to the operator, as the old paragraph says. A coordinator that reads the code's vocabulary, as #3577's did, may still send `ejected: conflict:#<pr>`; the line has accepted that kind since wave 5e, and an old worker's skill does not know the first line, so the worker asks (clause 5). | yes. The mail licenses nothing, and the operator learns at once instead of from a neighbour. |
| new skills, old server | No `head-held:` mail comes. The coordinator learns of a held head only from the reads of the line its text names (the read after the advance, a next-to-land mail, the 20-minute re-read when another run's train-closed PR holds the head). The exception sentence stands without the notice: on its own read and its own probe it may send the conflict ejection, which every server since wave 5e records. The sentence naming the notice describes a mail that does not come. | yes. Nothing waits on the mail. |
| both new | The coordinator is mailed once; it reads, probes, and either sends the run back with `ejected: conflict:#<pr>` or stops and reports. | yes |

Either order works. **Server first** is the order that helps sooner: the silence ends before every home has the text, and the old text's answer (report to the operator) is still a correct answer. Within the skills class the worker's and the coordinator's skill travel together. A home updated later reads the old worker bullet, and its worker asks on the new first line.

## 7. The text (Task 3)

Each old block below occurs exactly once at the baseline, as checked. Apply them with the check script of Task 3 Step 3, never by hand-editing around them. Wrapping is as given: the physical lines are the text.

### 7.1 Step 6's report-less paragraph (`ccd/coordinator-skill/references/wave-steps.md`)

**Change 1.** Old:

```
     cause you measured decides which of two forms it takes. **An ejection** is
     sent in two cases only: the new-head route for a red that is `main`'s own
     (`references/wave-lifecycle.md` §5b), and a dequeue (§5) whose cause is a
     conflict you measured: after one `git fetch origin`, `git merge-tree
     --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1
     with a tree id on its first line, then the conflicted paths. Its body holds
     three entries, one to a line, and nothing else: `ejected: new-head:#<pr>`
     or `ejected: dequeued:#<pr>`, then `base: <sha>`, the `origin/main` sha you
     read after one `git fetch origin`, then `checks: <required names that are
     red>` for the new-head route or `paths: <the conflicted paths>` for the
     dequeue. Every ejection is clause 15's ejection, its base recorded on the
```

New:

```
     cause you measured decides which of two forms it takes. **An ejection** is
     sent in three cases only: the new-head route for a red that is `main`'s
     own (`references/wave-lifecycle.md` §5b), a dequeue (§5) whose cause is a
     conflict you measured, and a conflict you measured on this run's own
     pinned entry before it was queued, at the head of the landing line or
     behind it (§5b, **The landing line**; D-9160): for a dequeue, after one
     `git fetch origin`, `git merge-tree --write-tree --name-only --no-messages
     origin/main <handoffCommit>` exits 1 with a tree id on its first line,
     then the conflicted paths, and for a pinned entry the same probe of its
     `pinnedSha` in place of `<handoffCommit>` does. Its body holds three
     entries, one to a line, and nothing else: `ejected: new-head:#<pr>`,
     `ejected: dequeued:#<pr>` or `ejected: conflict:#<pr>`, then `base:
     <sha>`, the `origin/main` sha you read after one `git fetch origin`, then
     `checks: <required names that are red>` for the new-head route or `paths:
     <the conflicted paths>` for a dequeue or a pinned entry. Every ejection is
     clause 15's ejection, its base recorded on the
```

**Change 2.** Old:

```
     `artifacts`. Every `ejected:` round's advance carries `ejection`, an
     object of two fields: `base`, the sha on the mail's `base:` line, and
     `kind`, `new-head` or `dequeued` as the mail's first line names it; a
```

New (the next physical line, which begins "`red:` round's advance", is `STEP6_AFTER`'s first and stays as it is):

```
     `artifacts`. A pinned entry's ejection has nothing to disarm: its PR was
     never queued, and §5b measures it only once that `--undo` has made it a
     draft (D-9115). Every `ejected:` round's advance carries `ejection`, an
     object of two fields: `base`, the sha on the mail's `base:` line, and
     `kind`, `new-head`, `dequeued` or `conflict` as the mail's first line names
     it; a
```

### 7.2 The landing-line paragraph (`ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`)

**Change 1.** Old:

```
PR that is not this run's, an answer you cannot read, or no entry for this PR
means stop and report what you read to the operator; never choose a successor.
```

New:

```
PR that is not this run's, an answer you cannot read, or no entry for this PR
means stop and report what you read to the operator, but for the conflict
send-back below; never choose a successor.
```

**Change 2.** Old (the train-closed rule's last three lines, then the first line of the next sentence group):

```
stay in the line until a later read settles them), mail the coordinator of that
entry's run (`toId: 'coordinator'` with its `runId`) what you read, or, for an
entry with no run, put it to the operator as an item.
A `held` binding, `opt-in-unknown` included, stops. A missing `binding` (a server older than wave 5i) is the only fallback to the checks
```

New:

```
stay in the line until a later read settles them), mail the coordinator of that
entry's run (`toId: 'coordinator'` with its `runId`) what you read, or, for an
entry with no run, put it to the operator as an item.
When the binding is held on this run's own entry for `composition-not-clean` and
the radar measured a conflict between its pinned head and the base, the server
mails this session one `head-held:#<pr>:<digest>` notice per entry, pin,
episode, base and recipient (D-9159); it is a cue to read the line again and
measure, never an instruction to eject, and it licenses nothing by itself. One
held binding is no stop: when the read's `binding` is `held` with `reason`
`composition-not-clean` and its `entryId` names this run's own entry, that entry
reads `pinned` with a `pinnedSha` equal to the head you bind, you have turned
the PR back into a draft with `gh pr ready <pr> --undo` as D-9115 above says and
`gh pr view <pr> --json isDraft` then reads `true`, and after one `git fetch
origin` your own `git merge-tree --write-tree --name-only --no-messages
origin/main <pinnedSha>` exits 1 with a tree id on its first line, send the run
back from `merging` with SKILL.md step 6's report-less round in its `ejected:
conflict:#<pr>` form, its `base:` the `origin/main` sha you read and its
`paths:` the conflicted paths (D-9160). Behind the head there is no binding to
read, because the binding reads only the head: when this run's own entry reads
`pinned` with a `pinnedSha` equal to the head you bind but is not the entry
`binding.entryId` names, the read's `binding` is not `held` with `reason`
`paused` or `recovery`, the PR reads a draft by that same undo and read, and the
same probe exits 1 with a tree id on its first line, send the run back the same
way, because such an entry cannot land and waiting only moves the hold to the
moment it reaches the head. Run that probe only on a read of the line this
paragraph already has you make for this run (the read after the advance to
`merging`, a next-to-land or `head-held:` mail, or the 20-minute re-read above
when the held head is another run's train-closed PR), once on that read; never
on a loop or a timer of your own for it. The send-back costs three things: the
entry's place, because the advance that brings the run back to `merging` re-pins
it with a new `pinnedAt`, so it re-enters behind every entry already in the line
unless `fixesMain` or an order edge places it otherwise, and both are kept; a
second send-back of one entry raises the server's one operator notice for an
entry ejected twice (SKILL.md step 6); and every entry with an order edge after
it waits while it is out, because an ejected entry is still outstanding. Nothing
else licenses that send-back: not another run's entry, not an entry whose
conflict you did not measure with that probe, not any other `reason`,
`head-mismatch` included, not a ready or queued PR, and not a probe that exits 0
or answers anything else; each stays a stop for the operator, and the server
ejects nothing and chooses no successor.
Every other `held` binding, `opt-in-unknown` included, stops. A missing `binding` (a server older than wave 5i) is the only fallback to the checks
```

**The stop paragraph is not edited.** It says a stop "changes nothing, with two exceptions". The conflict send-back is not a stop, in either position: at the head the new text says so ("One held binding is no stop"), and behind the head the binding names another entry, so this run's own entry has no held binding to stop on. So that paragraph and its two pins stay true and unchanged. "A next-to-land mail restarts this read and check from the top …" stays as it is; the new sentence already says what the notice is.

### 7.3 The worker's fix-round bullet (`ccd/worker-skill/SKILL.md`)

Old:

```
  A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>` or
  `ejected: new-head:#<pr>` has no report and no `artifacts`: it is clause
  16's ejection, and its three body lines are your whole brief. Absorb the
  `base:` sha with `git merge`, then fix only the `paths:` it names; on
  `ejected: new-head:#<pr>` the merge is the whole round, with nothing else in
  it. If the new-head merge does not apply cleanly, run `git merge --abort`,
  push nothing (clause 9) and ask, as clause 5 says: resolving a conflict is
  not that round's work. A `fix-round` mail whose first line reads
  `red: #<pr>` has no report, no `artifacts` and no `base:`: its `checks:`
  line is your whole brief, so fix the named checks on this branch. It
  licenses no absorb: clause 16's first two triggers still apply to it, and
  its third does not. Report a FRESH wave-done as for any fix round.
```

New (13 bytes shorter):

```
  A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>`,
  `ejected: conflict:#<pr>` or `ejected: new-head:#<pr>` has no report and no
  `artifacts`: it is clause 16's ejection, and its three body lines are your
  whole brief. Absorb the `base:` sha with `git merge`, then fix only the
  `paths:` it names; on `ejected: new-head:#<pr>` the merge is the whole
  round. If the new-head merge does not apply cleanly, run `git merge --abort`,
  push nothing (clause 9) and ask, as clause 5 says: resolving a conflict is
  not that round's work. A `fix-round` mail whose first line reads
  `red: #<pr>` has no report, no `artifacts` and no `base:`: its `checks:`
  line is your whole brief, so fix the named checks. It licenses no absorb:
  clause 16's first two triggers still apply to it, and its third does not.
  Report a FRESH wave-done as for any fix round.
```

The two phrases that go, and why each is redundant:
- ", with nothing else in it": "the merge is the whole round" already says it.
- " on this branch": the bullet's third sentence already says "fix on this workspace's own branch (clause 2)" of every fix round.

A conflict round is a dequeue's in every step the worker takes: absorb the base, resolve, fix the paths. So no other sentence changes. The cap entry stays at 35559. The ratchet prints the lower-it line and passes, and lowering it would add a file to the pull request for nothing.

### 7.4 The pins (Task 3)

The flattened sentences (whitespace runs replaced by one space), as the script measured them.

**`coordinator-skill.test.ts`, the report-less pins.** In `REPORT_LESS` and in the 5f whole pin, which repeats it, make these changes:

- Element 2 becomes:
  > **An ejection** is sent in three cases only: the new-head route for a red that is `main`'s own (`references/wave-lifecycle.md` §5b), a dequeue (§5) whose cause is a conflict you measured, and a conflict you measured on this run's own pinned entry before it was queued, at the head of the landing line or behind it (§5b, **The landing line**; D-9160): for a dequeue, after one `git fetch origin`, `git merge-tree --write-tree --name-only --no-messages origin/main <handoffCommit>` exits 1 with a tree id on its first line, then the conflicted paths, and for a pinned entry the same probe of its `pinnedSha` in place of `<handoffCommit>` does.
- Element 3 becomes:
  > Its body holds three entries, one to a line, and nothing else: `ejected: new-head:#<pr>`, `ejected: dequeued:#<pr>` or `ejected: conflict:#<pr>`, then `base: <sha>`, the `origin/main` sha you read after one `git fetch origin`, then `checks: <required names that are red>` for the new-head route or `paths: <the conflicted paths>` for a dequeue or a pinned entry.
- A new element goes after "For either form, on route Q disarm first …":
  > A pinned entry's ejection has nothing to disarm: its PR was never queued, and §5b measures it only once that `--undo` has made it a draft (D-9115).
- The element "Every `ejected:` round's advance carries `ejection` …" reads "… and `kind`, `new-head`, `dequeued` or `conflict` as the mail's first line names it; a `red:` round's advance, and any other retreat, carries none."

The other report-less cases:
- The case "sends a fix round with no report from merging in one of two forms …" takes elements 2 and 3 as above in its two `toContain`s.
- "names the report-less first lines the worker skill reads …" loops over `` '`ejected: conflict:#<pr>`' `` too.
- "no report-less sentence holds a double quote":
  - its opener `'**An ejection** is sent in two cases only'` becomes `'**An ejection** is sent in three cases only'`;
  - it gains `'A pinned entry\'s ejection has nothing to disarm'`.
- "records the base on the ejecting advance …" loops over `['new-head', 'dequeued', 'conflict']`.
- `STEP6_BEFORE` and `STEP6_AFTER` are untouched, and that case stays green as the proof that the physical lines it pins did not move.

**`coordinator-skill.test.ts`, the line pin.** In `LINE`:

- The element "On a project that is positively opted in, a `held` binding …" becomes:
  > On a project that is positively opted in, a `held` binding, a `binding` naming a PR that is not this run's, an answer you cannot read, or no entry for this PR means stop and report what you read to the operator, but for the conflict send-back below; never choose a successor.
- Six new elements go after the element "The reader marks such an entry by itself …":
  > When the binding is held on this run's own entry for `composition-not-clean` and the radar measured a conflict between its pinned head and the base, the server mails this session one `head-held:#<pr>:<digest>` notice per entry, pin, episode, base and recipient (D-9159); it is a cue to read the line again and measure, never an instruction to eject, and it licenses nothing by itself.

  > One held binding is no stop: when the read's `binding` is `held` with `reason` `composition-not-clean` and its `entryId` names this run's own entry, that entry reads `pinned` with a `pinnedSha` equal to the head you bind, you have turned the PR back into a draft with `gh pr ready <pr> --undo` as D-9115 above says and `gh pr view <pr> --json isDraft` then reads `true`, and after one `git fetch origin` your own `git merge-tree --write-tree --name-only --no-messages origin/main <pinnedSha>` exits 1 with a tree id on its first line, send the run back from `merging` with SKILL.md step 6's report-less round in its `ejected: conflict:#<pr>` form, its `base:` the `origin/main` sha you read and its `paths:` the conflicted paths (D-9160).

  > Behind the head there is no binding to read, because the binding reads only the head: when this run's own entry reads `pinned` with a `pinnedSha` equal to the head you bind but is not the entry `binding.entryId` names, the read's `binding` is not `held` with `reason` `paused` or `recovery`, the PR reads a draft by that same undo and read, and the same probe exits 1 with a tree id on its first line, send the run back the same way, because such an entry cannot land and waiting only moves the hold to the moment it reaches the head.

  > Run that probe only on a read of the line this paragraph already has you make for this run (the read after the advance to `merging`, a next-to-land or `head-held:` mail, or the 20-minute re-read above when the held head is another run's train-closed PR), once on that read; never on a loop or a timer of your own for it.

  > The send-back costs three things: the entry's place, because the advance that brings the run back to `merging` re-pins it with a new `pinnedAt`, so it re-enters behind every entry already in the line unless `fixesMain` or an order edge places it otherwise, and both are kept; a second send-back of one entry raises the server's one operator notice for an entry ejected twice (SKILL.md step 6); and every entry with an order edge after it waits while it is out, because an ejected entry is still outstanding.

  > Nothing else licenses that send-back: not another run's entry, not an entry whose conflict you did not measure with that probe, not any other `reason`, `head-mismatch` included, not a ready or queued PR, and not a probe that exits 0 or answers anything else; each stays a stop for the operator, and the server ejects nothing and chooses no successor.
- The element that begins "A `held` binding, `opt-in-unknown` included, stops. A missing `binding` …" begins "Every other `held` binding, `opt-in-unknown` included, stops. A missing `binding` …", the rest unchanged.

"no 5e sentence holds a double quote" gains the openers `'When the binding is held on this run'`, `'One held binding is no stop'`, `'Behind the head there is no binding to read'`, `'Run that probe only on a read of the line'`, `'The send-back costs three things'`, `'Nothing else licenses that send-back'` and `'Every other `held` binding'`.

**`coordinator-skill.test.ts`, one new case** in the 5e describe: `the conflict send-back is this run's own measured entry, at the head on composition-not-clean or behind it while the operator does not hold the line, and the notice licenses nothing (D-9159, D-9160)`. Over the flattened §5b prose, it asserts:

- `` '`ejected: conflict:#<pr>`' `` occurs exactly once;
- the sentence that holds it begins `One held binding is no stop:` and contains `` '`reason` `composition-not-clean`' ``, `"names this run's own entry"`, `` 'you have turned the PR back into a draft with `gh pr ready <pr> --undo` as D-9115 above says' ``, `` '`gh pr view <pr> --json isDraft` then reads `true`' `` and `'exits 1 with a tree id on its first line'`;
- the sentence beginning `Behind the head there is no binding to read` contains `"this run's own entry reads `pinned`"`, `` 'is not the entry `binding.entryId` names' ``, `` 'is not `held` with `reason` `paused` or `recovery`' ``, `'the PR reads a draft by that same undo and read'`, `'the same probe exits 1 with a tree id on its first line'` and `'such an entry cannot land'`;
- the sentence beginning `Run that probe only on a read of the line` contains `'this paragraph already has you make for this run'`, `"when the held head is another run's train-closed PR"` and `'never on a loop or a timer of your own for it'`, and does not contain `'a mail that names this run'`;
- the sentence beginning `The send-back costs three things` contains `` 're-pins it with a new `pinnedAt`' ``, `'one operator notice for an entry ejected twice'` and `'an ejected entry is still outstanding'`;
- the sentence beginning `Nothing else licenses that send-back` contains `"not another run's entry"`, `'not an entry whose conflict you did not measure with that probe'`, `` '`head-mismatch` included' `` and `'not a probe that exits 0 or answers anything else'`;
- the sentence beginning `When the binding is held on this run` contains `'notice per entry, pin, episode, base and recipient'`, does not contain `'head-mismatch'`, and the prose contains `'never an instruction to eject, and it licenses nothing by itself'`.

The line pin already holds these; this case names each condition, so a mutant that removes one reds a case named for it.

**`worker-skill.test.ts`.**
- "reads a fix-round mail with no report in its two forms …":
  - its first `toContain` becomes "A `fix-round` mail whose first line reads `ejected: dequeued:#<pr>`, `ejected: conflict:#<pr>` or `ejected: new-head:#<pr>` has no report and no `artifacts`: it is clause 16's ejection, and its three body lines are your whole brief.";
  - its second becomes "Absorb the `base:` sha with `git merge`, then fix only the `paths:` it names; on `ejected: new-head:#<pr>` the merge is the whole round.";
  - its fourth becomes "… its `checks:` line is your whole brief, so fix the named checks.";
  - the title is unchanged (still two forms: an ejection and a red).
- "pins the whole fix-round bullet …" takes the same three sentences in `whole`.

## 8. README, `CLAUDE.md` and the spec

**`README.md`** (another run's claim when this plan was written; packet first; Task 4). The paragraph that begins "The main-red hold has one writer". The old block is three whole physical lines, each ended by a line feed, the last of them line 6022 whole: it continues past "evidence." with "One trap: a project that opts out (its `lander` removed)", and the line after it ("while main is red keeps …") is not touched. Old:

```
The main-red hold has one writer: a fresh, same-base `main-health` measurement applied through the radar lane. A next-to-land mail
is sent once per exact episode, base and recipient; it tells a coordinator to re-read the line and is not merge permission. The
landed reader retires bounded damaged rows on fresh terminal evidence. One trap: a project that opts out (its `lander` removed)
```

New (+268 bytes):

```
The main-red hold has one writer: a fresh, same-base `main-health` measurement applied through the radar lane. A next-to-land mail
is sent once per exact episode, base and recipient; it tells a coordinator to re-read the line and is not merge permission. A
held-head mail (D-9159) is sent once per exact episode, base and recipient when the binding holds on the head entry's own conflict
with the base, as the radar measured it; it tells that entry's coordinator to re-read the line and measure; the server ejects nothing.
The landed reader retires bounded damaged rows on fresh terminal evidence. One trap: a project that opts out (its `lander` removed)
```

No README text describes the ejection kinds' mail forms, so D-9160 changes no README text.

**`CLAUDE.md`** does not change. It does not describe the cue, the binding's reasons or the ejection kinds. None of its rules is touched: no box-token door, SAFETY verb or ring rule.

**The spec** (the coordinator's, on the ledger pull request, as wave 5l's was). After §5.5's "Next to land" paragraph's last sentence, "No automatic replay/fence-clearing timer is added.", word for word:

> (Amended 2026-11-27, wave 5o, D-9159: when the selected head is held for `composition-not-clean` on a probe whose answer for its pinned head is `conflict`, the same transaction mails the cue's recipient one held-head notice per identity `['landing-head-held', 1, project, entryId, pr, pinnedSha, handoffCommit, pinnedAt, episode.kind, runIdOrNull, episodeOrCreationSeq, baseSha, toId]`, subject `head-held:#<pr>:<digest>`, deduplicated as the cue is. It is a cue to read the line: the server ejects nothing and chooses no successor, and every other held reason, `head-mismatch` included, sends nothing.)

D-9160 needs no spec line. Step 5 already says "On a conflict … the coordinator sends the owning worker a `fix-round` mail naming base B", and the conflict kind is in the line's vocabulary.

## 9. Tests by layer

**Pure (Task 2), `server/test/landing-next-mail.test.ts`.** New describe `nextLandingNoticeOf: the held-head notice (D-9159, pure)`, on the file's own `atMerging`, `nextFacts` and `controlAt`. One new local helper:
- `heldControl({ base, answer, head })` builds `controlAt(base)` with the probe's one head for PR 7 replaced by `{ pr: 7, head, branch, id, base: answer }`.
- It keeps the baseline's `branch` and `id`, read from `landingFixture.ts#controlRead`.
- `answer` is `{ state: 'conflict', paths: ['a.ts'], pathsCut: false }` by default, and `head` is `CONTROL_HEAD_SHA` by default.

The cases:

- **H1, a measured conflict.**
  - `atMerging()` plus a conflicting head answers `kind: 'held'`, `reason: 'composition-not-clean'`, `toId: 'coordinator-a'`, the run's id and `baseSha: CONTROL_BASE_SHA`.
  - Its `JSON.parse(identity)` equals `['landing-head-held', 1, 'project-a', e.id, 7, CONTROL_HEAD_SHA, HC, e.pinnedAt, 'run', id, episode, CONTROL_BASE_SHA, 'coordinator-a']`.
  - Its body starts `Held head for project-a #7, entry ` and contains `not an instruction to eject` and the identity.
- **H2, an unmeasured composition:** `{ state: 'unmeasured' }` answers `{ kind: 'no-send', reason: 'composition-not-clean' }`.
- **H3, a moved head, even one that conflicts:** the probe lists #7 at `'e'.repeat(40)` with the default `conflict` answer, and the result is `{ kind: 'no-send', reason: 'head-mismatch' }` (the coordinator's ruling on F3).
- **H4, a PR the probe does not list:** heads `[]` answers `{ kind: 'no-send', reason: 'head-mismatch' }`.
- **H5, other reasons over a conflicting head.** Each answers `no-send` with its own word:
  - `paused`: `{ ...f.facts, flags: { ...f.facts.flags, operatorPaused: true } }`;
  - `base-mismatch`: health's sha differs from the probe's base;
  - `probe-unmeasured`: a stale probe;
  - `opt-in-unknown`: an unreadable lander.
- **H6, the recipient.** With a conflicting head, the cue's recipient case runs again:
  - `run-unreadable` for `run` `'missing'`, `'unreadable'`, a foreign project and `id + 1` (another run's coordinator);
  - `run-not-merging` for `awaiting-review`;
  - `recipient-missing`;
  - `episode-unreadable`;
  - `episode-changed` for a changed episode head or PR.
- **H7, a no-run row.** An entry written by `creator-a`, then an order write by `lane-b`, with a conflicting head:
  - `toId: 'creator-a'` and `runId: null`;
  - the identity's episode members are `'no-run', null, creationSeq`.
- **H8, a ready binding is unchanged:** with the baseline clean head, the answer is `kind: 'send'` and its identity's first member is `'landing-next'`. The file's existing cue cases stay green, unchanged, but for the one case below.
- **H9, the identity's members:**
  - two conflicting reads on bases `CONTROL_BASE_SHA` and `BASE_B` give different identities;
  - the same read twice gives the same identity;
  - the identity has the cue's thirteen members in the cue's order, with `'landing-head-held'` in place of `'landing-next'`.

**Store (Task 2), the same file.** New describe `applyLandingControl: the held-head notice is queued once, durably (D-9159)`, with `heldMails()` and `heldObservations()` beside `cueMails()`: `subject LIKE 'head-held:%'` and `detail LIKE 'landing:head-held:v1:%'`. `conflictAt(base)` is `controlAt(base)` with PR 7's probe answer `conflict`. Every second call of a duplicate case passes a later clock, `coord.applyLandingControl({ project: P, control, nowMs: CONTROL_NOW + 60_000 })`, and after `reopen()` `CONTROL_NOW + 120_000`, so a dedupe key that carried the clock would go red ("What was measured"; review 4083, F5).

- **S1, one queue.** A conflicting head at `merging` gives:
  - one mail with subject `` `head-held:#7:${sha256(identity)}` ``, from `operator`, to `coordinator-a`, with the run's id and kind `status`;
  - one observation with detail `` `landing:head-held:v1:${digest}` ``;
  - the result `{ kind: 'held-queued', mailId, deliveryId, holdChanged: false }`;
  - and `cueMails()` is empty.
- **S2, the duplicate, on a later clock:** the second call at `CONTROL_NOW + 60_000` answers `{ kind: 'duplicate', holdChanged: false }`, and so does a call at `CONTROL_NOW + 120_000` after `reopen()`. There is still one mail and one observation.
- **S3, a new base:** the same conflict on `BASE_B` queues one new mail; on `BASE_B` again, on a later clock, it answers `duplicate`.
- **S4, a new pin:** under `vi.useFakeTimers()` with `vi.setSystemTime(1_000_000)`, after S1's notice the run is sent back with `ejection: { kind: 'conflict', base: CONTROL_BASE_SHA }`, the clock is set to `2_000_000`, and the run comes back to `merging` (`step(id, 'awaiting-review')`, `enterMerging(id)`). The same conflict then queues one new mail, and a third call answers `duplicate`: two mails in all.
- **S5, the run-less arm:** a no-run entry by `creator-a` with a conflicting head gives one mail to `creator-a` with `runId` null; a second call, on a later clock, answers `duplicate`.
- **S6, a run that left `merging`:** after `retreat(id)`, a conflicting probe queues nothing, and the answer's kind is `no-send`. A bare retreat ejects the entry, so it leaves the line and the binding has no head. The exact `run-not-merging` guard is H6's: the store cannot hold a pinned entry whose run is not at `merging`.
- **S7, the conflict clears:** after S1, a clean head queues the cue (one `next-to-land:` mail) and no second held mail. A conflict on the same base again answers `duplicate`.
- **S8, the flag:** a red health over a conflicting head gives the result `held-queued` with `holdChanged: true` and `flags().mainRedHold` true. The flag's writer is unchanged, and the notice rides the same transaction.
- **S9, a new recipient:** after S1, `UPDATE runs SET claimedBy = 'coordinator-b'` and the same conflict queue one new mail to `coordinator-b`: `heldMails().map((m) => m.toId)` is `['coordinator-a', 'coordinator-b']`.

S1 to S5 and S9 were run on the scratch build of "What was measured" and are green there; the three mutants named there each red the case named for them.

**The existing case that changes** (review 4083, F1; an intended behaviour change, so it is in Task 2's behaviour commit, never in a move commit). In the describe `applyLandingControl: an unhealthy selected head holds the line, and a later clean entry queues nothing (M12)`, the store `it.each(CASES)` case "%s: through the store, no cue is queued (zero mail, deliveries and observations), twice over" is red for its third row, as measured. The change:

- `CASES` stays as it is, and so does the binding `it.each(CASES)` over all three rows ("the binding names the selected entry as held, not the later clean one"): it is green before and after.
- The store `it.each` runs over the two `head-mismatch` rows only (`CASES.slice(0, 2)`), its expectation unchanged.
- The third row gets its own case: `a selected head whose composition conflicts with the base: through the store, no cue is queued, and its own coordinator gets one held-head notice, never the later clean entry's, twice over (D-9159)`. After `twoEntries()`:
  - `apply(control)` answers `toMatchObject({ kind: 'held-queued', holdChanged: false })`, and a second call answers `{ kind: 'duplicate', holdChanged: false }`;
  - `cueMails()` and `cueObservations()` are empty;
  - `rows('SELECT * FROM mail')` holds one row, with subject beginning `head-held:#7:` and `toId` `coordinator-a`, and `mail_deliveries` holds one row;
  - one `landing:head-held:v1:` observation stands.

No other existing case of the file, or of `landing-control`, `landing-terminal-damage`, `landing-read-route`, `landing-entry-census`, `radar-lane`, `landing-ejection-ask` and `landing-advance-route`, changes ("What was measured").

**Task 1's pure case**, in `landing-control.test.ts` beside its binding cases, `probedHeadOf answers the one head for a PR, or null`:
- a doc listing #7 once answers that head;
- a doc without #7 answers null;
- a hand-built doc listing #7 twice (the parser refuses one; the function still answers null) answers null.

**Text (Task 3):** the pins of section 7.4.

**Other suites to run** (each alone, through `ccrc test`):
- The landing files: `landing-control`, `landing-terminal-damage` (it counts `next-to-land:` cues only), `radar-lane` (it counts `next-to-land:` cues and spies on `applyLandingControl`), `landing-read-route` (the read queues no mail), `landing-entry-census`, `landing-ejection-ask`, `landing-advance-route`, `coord-policy-rings`, `rings/watcher-store-port`, `single-definition/core-vocab` and `mail-routes`.
- The readers of section "What was measured": the skill-text readers, the whole-tree scanners, the installers' suites and the README's readers.
- Run alone, never beside another heavy file: `typecheck-tests`, `session-hook`, `session-hook-merge-deny`, `session-hook-role-skill-deny` and `landing-next-mail`. `typecheck-tests` and `session-hook` are known load flakes (root `CLAUDE.md`): re-run one alone before calling a red a break.

## Global Constraints

- **One decider, one transaction.** The notice is decided in `nextLandingNoticeOf` and queued in `applyLandingControlTx`, nowhere else. Its recipient comes from the cue's own helper, and the probe's head from `probedHeadOf`. No new lane, poller, table or timer.
- **Decide in L1, act in L3.** `landingLine.ts` and `landingNext.ts` stay pure (no clock, fs, store or crypto). The digest is taken in `landingControlTx.ts`, as the cue's is.
- **No new state, journal record, route, migration, `ccd` verb, capability word, wire field, binding reason or ejection kind.** `FLEET_PROTO` stays 1, and `shared/` does not change.
- **The server ejects nothing and chooses no successor.** The binding reads the head only. No test or code path makes the notice write an entry, a run or a flag.
- **The text never licenses a send-back for another run's entry, another reason, or a line the operator holds.** No numbered clause of either `SKILL.md` changes. The worker's skill does not grow (R5).
- **No broken commit.** Each commit is green on its own: a move commit changes no expectation, and the behaviour change, its new cases and the one existing expectation it changes land in one commit.
- **Fixture data only.** Neutral names (`project-a`, `coordinator-a`, `coordinator-b`, `creator-a`, `lane-b`), small PR numbers, no real hosts or sessions. Cite code as `file#symbol`.
- **Every test and typecheck runs through `ccrc test -- <command>`**: in the foreground, tool timeout at least 600000 ms, `--maxWorkers=2`, cd'd in `server/`, one file per process. If it prints nothing for 15 minutes, stop it and run it with `--local` (#3481).
- **Claims and packets.**
  - Read `ccrc-api claims list --project ccrc-pwa` before each task and claim every path it edits, all or nothing.
  - `README.md` and `server/test/mail-routes.test.ts` were held by other runs when this plan was written. A claim id expires, so read the claims when the build starts; for each file another session holds then, send that session a unified diff against the named `main` commit, inline, with its size and sha256, and leave the file untouched until the answer.
  - Keep off `pwa/` and `ui/` (run 4073).
  - Read your own claims before the push: a claim has a hard expiry.
- **Commits** go on the workspace's own branch. Push once, when the wave is complete. The pull request stays a draft.
- **Task notes** go under `docs/superpowers/programs/landing-order/` as `wave5o-task-<n>.md`. Never edit an existing plan or the programme ledger.
- **Deviation numbers are issued, never chosen.** This plan defines D-9159 and D-9160. A departure found while building is named by slug (`D-TBD-<slug>`) in the wave-done mail, never in a tracked file.

## Review Focus

1. **A notice where there should be none.** An `unmeasured` composition, any `head-mismatch` (a PR the probe lists at another head, even with a conflict, or does not list), any other reason over a conflicting head, another run's coordinator, or a run not at `merging` (H2 to H6, S6; rows M2, M6, M10, M11).
2. **No notice, or two, where there should be one.** The measured conflict, the duplicate after delivery, after restart and on a later clock, the new base, the new pin, the new recipient, and the run-less arm (H1, H7, S1 to S5, S9; rows M1, M7 to M9, M20, M25 to M28).
3. **The cue unchanged.** A ready binding still sends `next-to-land:` with its identity and body byte for byte; the moves of `probedHeadOf` and `episodeOf` change no existing case; and the one existing case that changes is the measured-conflict row named in section 9 (H8, S7; rows M12, M13, M29).
4. **The text's send-back is narrow in both positions.**
   - At the head: this run's own entry, `composition-not-clean`, a draft measured after the `--undo`, its own probe exiting 1 with a tree id.
   - Behind it: the same, with the measured conflict alone as the trigger, never while the line is `paused` or in `recovery`, measured only on a read the text already makes.
   - Never another run's entry, an unmeasured conflict, another reason, a ready or queued PR, or a probe that exits 0 (section 7.2, the new case; rows M14 to M16, M21 to M24, M30 to M34).
5. **The mail forms agree.** Step 6, the advance's `kind`, the worker's first lines and `LANDING_EJECTION_KINDS` all name `conflict`, and the worker's skill does not grow (section 7; rows M17 to M19).

## What this does not claim

- **A held head is still a held line.** The notice ends the silence. It does not move the line: the entries behind a conflicting head wait until its coordinator sends the run back, or the operator withdraws the entry.
- **The notice is idle-gated mail.** It reaches the coordinator at its next idle turn, like any mail, and a coordinator that never idles reads it late.
- **A moved head gets no notice and no new move** (the coordinator's ruling on F3; the issue for it is the coordinator's to file). As measured ("What was measured"):
  - the probe lists the heads, then measures them, and stamps its document at the end of the pass, every five minutes (`OnUnitActiveSec=5min`), and the server reads a document as fresh for twenty (`RADAR_PROBE_FRESH_S = 1200`); so a stamp later than a pin does not prove the heads were read after it;
  - only an advance to `merging` re-pins a head (`decideLandingWrite`'s `repin` act), so a head pushed while its run waits at `merging` stays unpinned and the binding reads `head-mismatch`;
  - a retreat from `merging` of a run whose pull request head moved after the pin is an ordinary ejection: the episode head is the pinned head, written once with the pin (`CoordStore.advanceLanding`'s `mergingAtDetail(landing.head, …)`), so `decideLandingWrite` takes its `eject` act and counts it; its `quarantine` act (wave 5f: no ejection, base, count or notice, and `unknown` with the `stale-episode-head` marker until a verified re-pin) is reached only when the entry's pin is not the retreating episode's head. So a plain send-back would re-pin a moved head at the next advance, at the cost of section 1's three costs; the text does not license it, and whether it should is the issue the coordinator files.
  The text's answer to that binding stays a stop reported to the operator. This wave builds nothing for it.
- **A PR whose base is not the probe's, or a pull request from a fork,** reads `head-mismatch` with the PR not listed, gets no notice, and holds the line until the operator withdraws its entry. A run's PR targets the repository's default branch from a branch of the repository itself, so both are stated edges.
- **An unmeasured composition gets no notice,** however long it lasts. That is the radar's to answer, and its own warnings say so.
- **An entry behind the head that conflicts is not noticed** (the coordinator's ruling on question 5: not in this wave; decided when wave 5o is live). The notice stays head-only, and the coordinator measures such an entry only on a read of the line its text already makes.
  - **The radar already measures it**: `ProbeDoc.heads` carries one element per open same-repository PR on the base (up to its `headsCut`), each with its `base` composition, each pass; both the radar lane (`control.probe`, the decider's input) and `radar.ts#sessionLandingsOf` (the console's chip) read it.
  - **The decider could take it as an input without a second prober or poller.** The probe is already `control.probe`, and `probedHeadOf` would find each pinned entry's head in it.
  - **But it is not one more case in the same decider as it stands.** `nextLandingNoticeOf` answers at most one notice per project per pass, for the selected head, and the transaction queues at most one mail. Covering the entries behind the head would make the answer a list and the transaction a loop over it, each with its own recipient and identity; and a cut probe already holds the head at `probe-unmeasured`.
- **A conflict found while the PR is in the queue** is not this form's. The queue's own dequeue and its `ejected: dequeued:#<pr>` still answer it, and the exception requires a draft.
- **A no-run entry's notice reaches its creator,** who has no run to send back. That entry is changed only through the operator's withdrawal, as today.
- **The issue's six-entry wait is quoted, not re-measured.** The order of events comes from issue #3577; this plan re-measured the code that let it happen.
- **Issue #3552** (a gloss for "damaged") touches the same paragraph and is not built here.

---

## Wave 5o — the held head (Tasks 1 to 5, one pull request)

### Task 1: the probe's one head (D-9159)

**Files:** `server/src/coord/landingLine.ts`, `server/test/landing-control.test.ts`, `docs/superpowers/programs/landing-order/wave5o-task-1.md` (new).

- [ ] **Step 1: claim** the files.
- [ ] **Step 2: characterization first.** Run `landing-control.test.ts` and `landing-next-mail.test.ts` at the baseline. Both are green, and their counts go in the note.
- [ ] **Step 3: the move.** Add `probedHeadOf` (section 5.1) and call it from `landingBindingOf`, changing nothing else. The type import widens to `ProbeDoc` and `ProbeHead`. Add Task 1's pure case.
- [ ] **Step 4: green.** The same two files, unchanged, plus the new case.
- [ ] **Step 5: commit** `refactor(landing): the probe's one head for a PR is one exported reader (wave 5o, D-9159)`.

### Task 2: the held-head notice, decided and queued (D-9159)

One task, two commits: the move of the recipient rule under green characterization, then the behaviour change whole (review 4083, F1 and F2). No commit between them is red.

**Files:** `server/src/coord/landingNext.ts`, `server/src/coord/landingControlTx.ts`, `server/test/landing-next-mail.test.ts`, `server/test/mail-routes.test.ts` (another run's claim when this plan was written: packet first), `docs/superpowers/programs/landing-order/wave5o-task-2.md` (new).

- [ ] **Step 1: claim** the files you can. Read the claims; for `mail-routes.test.ts`, send its holder the packet: two `NOT_CODES` rows beside `'landing-held'`, worded as their neighbours are:
  - `'landing-head-held',// coord/landingNext.ts: the held-head notice's identity tuple tag (landing order wave 5o, D-9159), a tag on a stored value, not a mail or run refusal code`
  - `'held-queued',      // coord/landingNext.ts#LandingControlApplyResult: the held-head notice's queued kind (landing order wave 5o, D-9159), a pure-decider discriminant, not a mail or run refusal code`

  Wait for the answer before editing that file.
- [ ] **Step 2: the move.** Move the recipient block into `episodeOf` (section 5.4), the ready path unchanged. Run `landing-next-mail.test.ts` alone: all 49 cases green, unchanged.
- [ ] **Step 3: commit** `refactor(landing): the cue's recipient rule is one private helper (wave 5o, D-9159)`.
- [ ] **Step 4: red first.** Write H1 to H9 and S1 to S9 (section 9), and make the one existing case's change of section 9 ("The existing case that changes"). Against the new types the typecheck is the first red. At run time, record in the note which cases are red and why:
  - H1, H6, H7 and H9 are red: today a held binding answers `no-send` with its own word (H6's words are the recipient's).
  - S1 to S5, S8 and S9 are red: nothing is queued today. S7's second half depends on S1.
  - The changed existing case's new third-row case is red; its two-row store case is green.
  - H2 to H5, H8 and S6 pass on the baseline, because today every held binding sends nothing. They are characterization pins of today's answers through the move; rows M2 and M6 prove that `heldOf`'s two refusals guard.
- [ ] **Step 5: the behaviour.** Add the types of section 5.2, `heldOf` (section 5.3), the held arm of section 5.4, the identity and body of section 5.5, and the transaction of section 5.6, with the two census rows once the holder answers. Update both header comments: the decider's decisions are now the cue and the held-head notice, both through one recipient rule.
- [ ] **Step 6: green.** `landing-next-mail.test.ts` alone; then each alone: `mail-routes`, `landing-control`, `landing-terminal-damage`, `radar-lane`, `landing-read-route`, `landing-entry-census`, `landing-ejection-ask`, `landing-advance-route`, `coord-policy-rings`, `rings/watcher-store-port` and `single-definition/core-vocab`. Then `ccrc test -- npx tsc --noEmit -p tsconfig.json` and `ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json`.
- [ ] **Step 7: commit** `feat(landing): a held head its own coordinator can clear gets one notice, in the cue's own decider and transaction (wave 5o, D-9159)`. The commit message names the one existing case whose expectation it changes and why: the notice is this commit's intended behaviour.

### Task 3: the text (D-9160)

**Files:** `ccd/coordinator-skill/references/wave-steps.md`, `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`, `ccd/worker-skill/SKILL.md`, `server/test/coordinator-skill.test.ts`, `server/test/worker-skill.test.ts`, `docs/superpowers/programs/landing-order/wave5o-task-3.md` (new).

- [ ] **Step 1: claim** the files.
- [ ] **Step 2: red first.** Change the pins as section 7.4 says, and add the new case. Run `coordinator-skill.test.ts` and `worker-skill.test.ts`: the changed pins and the new case are red. Record which cases.
- [ ] **Step 3: the text.** Save each old and new block of sections 7.1 to 7.3 as its own file in `$TMPDIR/5o-text/` (never in the work tree), holding the block's lines exactly as section 7 prints them, each ended by a line feed. Then run, from the work tree:

```bash
python3 - "$TMPDIR"/5o-text <<'PY'
import pathlib, sys
d = pathlib.Path(sys.argv[1])
plan = [('ccd/coordinator-skill/references/wave-steps.md', ['ws1', 'ws2']),
        ('ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md', ['lw1', 'lw2']),
        ('ccd/worker-skill/SKILL.md', ['wk1'])]
for rel, keys in plan:
    p = pathlib.Path(rel); text = p.read_text()
    for k in keys:
        old = (d / f'{k}.old').read_text(); new = (d / f'{k}.new').read_text()
        assert text.count(old) == 1, f'{rel} {k}: old occurs {text.count(old)} times'
        text = text.replace(old, new)
        assert text.count(new) == 1, f'{rel} {k}: new occurs {text.count(new)} times'
    p.write_text(text)
print('text: five changes applied')
PY
```

- [ ] **Step 4: green.** In this order:
  - `coordinator-skill.test.ts` and `worker-skill.test.ts`;
  - `skill-size-ratchet.test.ts`, which prints the worker's lower-it line and passes;
  - each skill-text reader, whole-tree scanner and installer suite of section "What was measured", one file per process, the load-sensitive ones alone.
- [ ] **Step 5: commit** `docs(coordinator, worker): the third ejection, for this run's own conflicting entry, and the held-head notice (D-9159, D-9160)`.

### Task 4: the README

**Files:** `README.md` (another run's claim when this plan was written: packet first), `docs/superpowers/programs/landing-order/wave5o-task-4.md` (new).

- [ ] **Step 1: the packet.** Read the claims. Send the session that holds the README's claim then the unified diff of section 8 against the `main` commit you build on, inline, with its size and sha256. Wait for the answer, and touch nothing before it.
- [ ] **Step 2: the change.** Save section 8's old and new blocks as `$TMPDIR/5o-text/rm1.old` and `rm1.new`, three and five whole lines, each ended by a line feed, and apply them with Task 3 Step 3's script over `[('README.md', ['rm1'])]`: old text once, new text once.
- [ ] **Step 3: green.** Each README reader of section "What was measured", one file per process, `session-hook` alone.
- [ ] **Step 4: commit** `docs(readme): the held-head mail beside the next-to-land cue (D-9159)`.

### Task 5: the gate and the notes

**Files:** `docs/superpowers/programs/landing-order/wave5o-task-5.md` (new).

- [ ] **Step 1:** the server typecheck and the test typecheck through `ccrc test`. Then every file of Tasks 1 to 4 again, one per process.
- [ ] **Step 2:** each task note lists:
  - its mutation rows as measured: the red case named, then restored, preferably with `../ccrc-coordinator/references/mutation-run.py`;
  - the files claimed and packeted;
  - what moved since the baseline.
- [ ] **Step 3:** the wave-done mail lists anything here the builder could not keep.

## 10. Mutation table

Each row is one change to the built code, measured red by the named case, then restored.

| id | Mutation | Predicted red |
|---|---|---|
| M1 | `heldOf`'s composition arm answers null | H1; S1; the changed existing case |
| M2 | `heldOf`'s `probed.base.state === 'conflict'` dropped (any non-clean answer sends) | H2 |
| M3 | `landingBindingOf` keeps its inline lookup and `probedHeadOf` answers the first match of many | Task 1's case (the twice-listed doc) |
| M6 | `heldOf`'s `reason !== 'composition-not-clean'` test dropped (every held reason reads the probe) | H3 (a `head-mismatch` listed at another head with a conflict now sends); H5 |
| M7 | the identity drops `held.baseSha` | H9; S3 |
| M8 | the identity carries the binding's reason and the probe's head again (an extra member) | H1 (the identity's exact members); H9 |
| M9 | the run arm's detail carries the time (`landing:head-held:v1:${digest}:${nowMs}`), so the dedupe never matches | S2 (on its later clock; measured: green under the fixed clock, red under `CONTROL_NOW + 60_000`) |
| M10 | `episodeOf` drops `run.id !== entry.runId` (another run's claimant is named) | H6; the cue's existing recipient case |
| M11 | `episodeOf` drops `run.state !== 'merging'` | H6; the cue's existing case |
| M12 | the transaction uses `head-held` for both answers | S7; the cue's existing store cases |
| M13 | the ready path answers kind `held` (with `reason: 'composition-not-clean'`) in place of `send` | H8; the cue's existing cases |
| M14 | section 7.2's "names this run's own entry" becomes "names the head entry" | the line pin; the new case |
| M15 | section 7.2's "`reason` `composition-not-clean`" becomes "any `reason`" | the line pin; the new case |
| M16 | section 7.2's closing sentence loses "not another run's entry," | the line pin; the new case |
| M17 | `` `ejected: conflict:#<pr>` `` removed from the worker's bullet | "names the report-less first lines …"; the worker's two pins |
| M18 | `conflict` removed from step 6's `kind` list | `REPORT_LESS`; the 5f whole pin |
| M19 | `'conflict'` removed from `LANDING_EJECTION_KINDS` in a scratch copy | "records the base on the ejecting advance …" |
| M20 | `episodeOf`'s no-run arm takes `entry.setBy` (the later order setter) | H7; the cue's existing no-run case |
| M21 | section 7.2's behind-the-head sentence names "an entry" in place of "this run's own entry" (the early form for another run's entry) | the line pin; the new case |
| M22 | section 7.2's behind-the-head sentence loses "and the same probe exits 1 with a tree id on its first line" (the early form for an entry whose conflict nobody measured) | the line pin; the new case |
| M23 | section 7.2's closing sentence loses "not an entry whose conflict you did not measure with that probe," | the line pin; the new case |
| M24 | section 7.2's measuring sentence loses "never on a loop or a timer of your own for it" | the line pin; the new case |
| M25 | the transaction maps a `held` answer's queue to `queued` in place of `held-queued` | S1; S8; the changed existing case |
| M26 | the run-less arm's subject carries the time (`` `head-held:#${pr}:${digest}:${nowMs}` ``), so `hasMailWithSubject` never matches | S5 (on its later clock; measured red) |
| M27 | the identity keeps only the project, the entry, the PR, the base and the recipient (drops `pinnedSha`, `handoffCommit`, `pinnedAt` and the episode members) | S4 (a new pin is one new mail; measured red) |
| M28 | the identity drops `episode.toId` | S9 (a new recipient is one new mail) |
| M29 | the changed existing case is left as it was (the store `it.each` over all three rows) | that case, red against the built code (measured: 1 failed of 49) |
| M30 | section 7.2's head sentence loses "you have turned the PR back into a draft with `gh pr ready <pr> --undo` as D-9115 above says and `gh pr view <pr> --json isDraft` then reads `true`" (the draft condition at the head) | the line pin; the new case |
| M31 | section 7.2's behind-the-head sentence loses "the PR reads a draft by that same undo and read" (the draft condition behind the head) | the line pin; the new case |
| M32 | section 7.2's head sentence loses "exits 1 with a tree id on its first line" (the head's probe condition) | the line pin; the new case |
| M33 | section 7.2's closing sentence loses "and not a probe that exits 0 or answers anything else" | the line pin; the new case |
| M34 | section 7.2's behind-the-head sentence loses "the read's `binding` is not `held` with `reason` `paused` or `recovery`," (the early form while the operator holds the line; the coordinator's ruling 2) | the line pin; the new case |

Rows M10, M11 and M20 were green before this wave through the cue's own cases. They are listed because the helper is now shared, and each must red a held case too. M4 and M5 of the previous revision are gone with the `head-mismatch` arm: with one arm, `heldOf`'s `probed !== null` and `control.probe.ok` tests are equivalent mutants (section 5.3), so no row claims them.

## 11. Questions for the coordinator's ruling

All six were ruled on 2026-11-27 with fix round 1 (review 4083). The rulings, as this plan keeps them:

1. **`head-mismatch` with the PR open at another head:** not in this wave (ruling 1). No notice and no send-back; section 2 and "What this does not claim" give the measured facts, and the coordinator files the issue.
2. **The identity:** settled by ruling 1. It is the brief's, and the bound is one mail per move of `main` while the conflict stands, plus one per new pin and one per new recipient (sections 1 and 5.5).
3. **The worker's bullet** loses its two redundant phrases; no cap raise (section 7.3).
4. **The draft condition** stays in both positions, measured after the `--undo` (section 7.2, F4's order).
5. **A notice for an entry behind the head:** not in this wave. It stays under "What this does not claim" with the review's evidence, and the coordinator decides it when wave 5o is live.
6. **The measuring words:** kept, with no new timer, and with the reads named as the text makes them today (section 7.2, F11).

No question is open.

## Deviations found

Two numbers are defined below, both issued on 2026-11-27 for this plan.

- **D-9159 (2026-11-27)** — `held-head-notice`: the next-to-land cue's decider (`landingNext.ts#nextLandingNoticeOf`) answers `held`, and its transaction (`landingControlTx.ts#applyLandingControlTx`) queues it, when a project's binding is held on its head entry for `composition-not-clean` and the probe's answer for the pinned head is `conflict`.
  - Every other held reason sends nothing, `head-mismatch` included (the coordinator's ruling after review 4083: a probe stamped after the pin may have listed the heads before it, and the text's only answer there is a report).
  - The recipient comes from the cue's own rule, now one private helper. The subject is `head-held:#<pr>:<digest>`, and the run arm's detail is `landing:head-held:v1:<digest>`. The duplicate is refused by the cue's two mechanisms.
  - The identity tuple is `['landing-head-held', 1, project, entryId, pr, pinnedSha, handoffCommit, pinnedAt, episode.kind, runIdOrNull, episodeOrCreationSeq, baseSha, toId]`: while the conflict stands, one mail per move of `main`, per new pin and per new recipient.
  - The body is a cue to read the line and measure, never an instruction to eject.
  - The probe's one head for a PR is read by one exported function (`landingLine.ts#probedHeadOf`), shared with the binding.
  - Why: a head that conflicted with `main` before it was queued held the line for about half an hour, and no mail told its coordinator (issue #3577). The checks lane had left at the draft, and nothing was queued to be dequeued.
  - No second decider, lane, table or wire field. The server ejects nothing and chooses no successor. An unmeasured composition sends nothing.
  - It extends spec §5.5's "Next to land" paragraph, which speaks of the ready head only. The coordinator adds section 8's dated line to §5.5 on the ledger pull request.
- **D-9160 (2026-11-27)** — `conflict-ejection-in-the-text`: the coordinator's step 6 names the line's third ejection kind, `conflict`, which every server since wave 5e accepts. The landing-line paragraph licenses it for this run's own pinned entry wherever it stands in the order (the coordinator's call 1758).
  - At the head: a held binding with reason `composition-not-clean`, on a PR turned back into a draft with `gh pr ready <pr> --undo` and then read `isDraft` true, after this coordinator's own `git merge-tree` of the entry's `pinnedSha` against `origin/main` exits 1 with a tree id.
  - Behind the head: the same draft PR and the same probe, with no binding to read, never while the line is held `paused` or in `recovery`. It is measured only on a read of the line the text already makes for this run, never on a loop or a timer of its own, because such an entry cannot land and waiting only moves the hold.
  - The cost is stated, all three: the re-pin at the next advance to `merging` sets a new `pinnedAt`, so the entry re-enters behind every entry already in the line unless `fixesMain` or an order edge places it otherwise; a second send-back raises the operator's ejected-twice notice; and every entry with an order edge after it waits while it is out.
  - The send-back is the report-less round's `ejected: conflict:#<pr>` form, with `base:` and `paths:`, the same in both positions, and nothing to disarm.
  - Never for another run's entry, an unmeasured conflict, another reason, a ready or queued PR, or a probe that exits 0. Every other held binding stops.
  - The worker's skill reads the third first line, within its size.
  - Why: the text named two ejections, so the coordinator of #3577's entry had to read the code's vocabulary to send its own run back, and its worker had no form for the mail.
  - No numbered clause of either `SKILL.md` changes, and no spec line is needed: §5.5's step 5 already sends a conflict back with its base.
