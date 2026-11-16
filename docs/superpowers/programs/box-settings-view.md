# Program: box-settings-view

Spec: `docs/superpowers/specs/2026-10-25-box-settings-view-design.md` (#1417).
Plans: `docs/superpowers/plans/2026-10-25-box-settings-view.md` (wave 1) and
`docs/superpowers/plans/2026-11-04-box-settings-view-w2.md` (wave 2). Each wave's worker committed its plan as its PR's
first commit.
Workspace: each wave's child workspace, minted by its dispatch.

On 2026-10-25 the operator asked why `CCRC_BACKUP_KEEP` is not shown in the console if it is an important setting. Only
the `ccrc` CLI on each box reads ccrc's settings, so the console has nothing to show. The coordinator offered to file a
read-only Box settings panel and build it as the wave after #1410, and the operator answered "yes please do that".
Wave 1 shows the spec's seven named settings. On 2026-11-04 the operator ruled that a wave 2 covers the remaining
ones, so this is now a two-wave programme.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | A read-only `ccrc settings` verb and its snapshot; a five-minute timer on every Linux box; the snapshot as an eleventh node file on `NodeWire.settings`; a Box settings card under Settings › Updates. | #2193 | **MERGED** 2026-11-04 01:28 UTC as `98ade6885`, at head `4035979d8` (run 1369, dispatched 2026-11-03 06:56 UTC; four review rounds). |
| 2 | The 82 other names in `CCRC_SETTINGS`, each with a display class: 54 shown, 28 omitted; a version-2 snapshot read beside version 1. | #2295 | **MERGED** 2026-11-05 08:44 UTC as `42f57f9ef`, at head `b0cf9a36e` (run 1409, dispatched 2026-11-04 08:32 UTC; three review rounds). |

## Decisions & deviations

- **Deviation block:** six numbers, 6914 to 6919, issued 2026-10-25 to this programme.
  - 6914: the verb.
  - 6915: the timer.
  - 6916: the node file, its validator and the wire.
  - 6917: the card.
  - 6918: the growth waiver for the CLI file, if one is needed.
  - 6919: a spare.
- **The CLI stays the one reader** (spec D1). No TypeScript copy of the settings reader, and no agent op that runs the
  CLI.
- **Read-only** (spec D5). Editing a setting from the console is a separate decision.
- **In line with the DDD/Clean/SOLID refactor in flight** (the operator, 2026-10-25: "ensure this plan is in line with the
  ddd/clean/solid refactor changes currently in progress too"). Four Opus lenses checked the spec and plan against the
  rings, decide-in-L1, the shared kernels, refusal and wire totality, and the bash anti-corruption layer, each with an Opus
  verifier: 40 findings, 39 kept, 1 refuted. Spec revision 3 and the plan carry the result:
  - an L1 parse and view, and a ring-declared lane on the `inventory` row, with its state owned by FleetWatcher;
  - shared vocabularies held set-equal to the bash writer;
  - the one redactor and the one usage refusal;
  - characterization-first carve-outs.
  The spec's D10 (the carve-outs inside this PR, or their own PR first) waits on the operator with D2, D3 and D7.
- **Routing:** a worker executing a spec'd plan, as one dependent chain (CLI, units, server, PWA) that fits one
  context. That is Opus at high effort, Sonnet high subagents, workflows off and compaction at 40 (the routing matrix's
  worker row). The review uses the held-out panel.

- **2026-11-02 UTC: the ledger lands on `main`, and the dispatch gates are re-measured.** Until today this ledger
  existed only on the coordinator's workspace branch. It lands now on its own ledger PR, with only this entry and the
  wave's state added. Both gates named above are met. Review-cap-lift's wave 1 was accepted and merged on 2026-10-26
  (#1524). On 2026-10-26 the operator approved the spec's D2, D3, D7 and D10 as written. The coordinator
  then held the dispatch until centralised update management's wave 29 (run 985) landed, because both waves edit the
  settings code in `ccd/ccrc` and the install census. Wave 29 merged on 2026-10-29 (#1578), and that programme closed
  on 2026-11-01. Measured today: #1417 is open, no run of this programme is open, and the spec is still only on the
  coordinator's workspace branch, with the plan held by the coordinator. The worker copies both into its PR, as above.
  This entry dispatches nothing: opening the run, a fresh claim read and a re-check of the plan's rebase triggers come
  first.

- **2026-11-03 06:56 UTC: wave 1 dispatched as run 1369**, on the operator's word ("Dispatch").
  - **Routing:** as above (Opus high, Sonnet high subagents, workflows off, compaction at 40). The plan's five tasks are the
    run's five items.
  - **Pre-dispatch audit:** three Opus lenses, read only, at base `408d93806`. The wave was still needed, but
    `CCRC_SETTINGS` had grown from 7 names to 87.
  - **Coordinator corrections at 408d93806 (2026-11-03):** a section the plan carries before its Deviations found.
    - Cite code by symbol.
    - Reuse `_upd_release_base`.
    - Put the growth waiver under `growth-waivers/`.
    - Give `deploy.sh`'s reason for withholding the timer.
    - Give the lane no clock of its own.
    - Build the source guards on the scan helper.
  - **Deviation numbers 7861 to 7863**, issued at run-open:
    - **D-7861, scope:** the snapshot carries exactly the spec's seven named settings, as its own ordered literal. Each
      appears once in `CCRC_SETTINGS`. The other names are out of scope for wave 1; several are key files, tokens,
      paths or URLs. A later wave decides them, each with a display class (wave 2 below).
    - **D-7862:** a spare.
    - **D-7863:** a spare, later superseded by D-7874.
- **Consents under wave 1's claims.** Every one was measured disjoint before it was given, on the standing terms: the
  PR that lands second merges `main`, and nothing is rebased.
  - **Received:** from the delegation broker's coordinator, for this wave's edits to `ccd/ccrc-doctor-checks` and
    `README.md` under #1619's claims.
  - **Given by the coordinator:**
    - desktop polish PL6 (run 1387): one entry in `shared/api.ts`;
    - the delegation broker's PR 3 (#2191): its `server/src/watch.ts` close path;
    - the native docs reader's first-load compression wave: one README sentence.
  - **Given by the worker under its own claim:** landing order 5f (run 1312), three README hunks.
- **Review 1385 (round 1, at `8ffc4f78f`): sent back.**
  - **D-7873 (F1):** after redaction and the authority cut, any `@` left past the scheme makes the release-base row read
    `custom` alone. It departs from the text of spec 2.1's algorithm in order to keep 2.1's promise: never userinfo.
  - **D-7874:** a new failure word, `unmeasured`, for a node the server holds no read of since it started. It
    supersedes D-7863's `unreadable`, so that two conditions never share one value at the seam.
  - **D-7875:** a spare at first. Fix round 1b used it to narrow the interrupted-write promise to what a
    handshake-ordered test can pin:
    - a SIGTERM before the rename keeps the last good file;
    - a SIGTERM during the rename leaves the last good file or the whole new one, never a partial file;
    - neither leaves a temp file.
  - **Also fixed:** F2 and F3, and A1 to A5 and A8 to A12. The decider moved into L1 (`boxSettings.ts`), so L4 only
    reads and stores. The card renders the server's age.
  - **The CodeQL thread** at `ccrc-install-units.test.ts` was a test-only false positive. It was fixed by passing the
    home in the environment, and the thread reads resolved.
  - **NO CHANGE:**
    - A6: its sentence was new to the verb, so it is marked.
    - A7: a follow-up, since the guard is blind to `st=` writes.
    - A13: the accepted residual of query tokens. The verb header names it, and ARCH-67 folds it.
    - The strict v1 parser stays (spec 2.4). So the **first change that adds a key to the snapshot must roll out
      `--server-first`**.
- **Merges of `main` into the wave branch: two.**
  - The first, under the worker's own clause-16 absorb, resolved `fleet.css` by keeping both blocks.
  - The second, on the coordinator's word after a measured conflict, made the two L0 import pins name both new
    imports: fifteen lines, after #2173.
- **macOS, round 1:** three `ccrc-settings-verb` rows had been written for Linux only. They now expect each platform's
  own answer from `main`'s readers. Review 1396 confirmed that this is characterization, not a defect accepted by a
  test.
- **Review 1396 (round 2, at `c1dd57b1e`): sent back.**
  - **D-7899:** the lane departs from plan correction 5. Its constructor takes nothing, and each call takes the
    sweep's ios.
  - **D-7900:** a spare, and it stayed unused.
  - **F1:** raw whitespace, or any byte that starts a token for `_upd_redact`, makes the row read `custom` alone (D-7873
    extended).
  - **F8:** spec revision 4 adds `unmeasured` to 2.4's closed list of failure words, so the spec is true when the code
    lands.
  - **F12:** a first read that throws stores `unreadable`. A node never tried stays `unmeasured`.
  - **Rewordings:** F2 to F7, F9 to F11, and the other F12 items. F3 is the `_plat_timeout` bound: 30 s, 36 s at the
    default grace, and 46 s at the clamp.
  - **NO CHANGE:**
    - the card gains no deadline readout (spec 2.5);
    - a refused numeric value gets no new cut (the A13 residual);
    - the copies of the `CCRC_SETTINGS` reader stay as they are.
- **Review 1398 (round 3, at `fca433ef2`): sent back to close the leak class.**
  - **The finding:** a `/` inside a password still left a credential prefix in the release-base row. It was the third
    shape of one leak.
  - **The ruling closes the class, not the byte:**
    - a `/`, `\` or `=` between the scheme's `://` (or the value's start) and the last `@` reads `custom` alone;
    - the worker walks `_upd_redact`'s KNOWN LIMITS and closes any other shape;
    - only `http://` and `https://` read as a scheme.
  - **Accepted:** revision 4's extra bullet.
  - **Considered and not ruled:** "any `@` in the raw value reads `custom` alone" is total, but it drops the host of every
    credentialed base that spec 2.1 shows. That tradeoff is the operator's, if wanted.
- **The review cap.** Run 1369 spent its three review rounds. The operator lifted the cap for the run on 2026-11-03, from
  the console.
- **Review 1403 (round 4, at `4035979d8`): accepted.**
  - **No blocking finding.** The leak class is closed: 63 hand-built shapes and 70,000 random ones put no userinfo byte
    in the origin. Each of the three new rules has a mutant that turns a row red.
  - **F1, accepted for this PR:** the helper's header and the README say any other scheme reads `custom` alone. That is
    false for a scheme that follows a userinfo (`user:pw@ftp://h` shows `ftp://h`), but nothing leaks. Wave 2's
    Task 1 makes the code true to the sentence by testing the redacted scheme as well. F3 (the header's first
    sentence) and F4 (the plan's importer list) go to the same task.
  - **NO CHANGE:** F2 (the README follows the round-3 ruling's wording) and F5 (the suite's rows, not the uncommitted
    probe, are the guard).
- **macOS arbitration.** macOS gates nothing.
  - `ccrc-settings-verb`'s last macOS result is 92/92 at `c1dd57b1e`. At `fca433ef2` and `4035979d8` its shard hit the
    55-minute limit three times before the file reported.
  - A targeted run is not possible: `macos.yml`'s `workflow_dispatch` takes no inputs, and no workflow was edited for
    it. No fourth re-run was ordered.
  - Review 1403 read the new rules for any behaviour that differs on macOS and found none. They use builtins only,
    under `LC_ALL=C`.
  - The daily run and the stable gate both run macOS in full, so a macOS-only miss is caught there.
- **2026-11-04: landed.** Landing verdict ROUTE Q; enqueued with `--match-head-commit 4035979d8`.
  - The first queue entry was dropped by two `ccrc-install-units` migration rows that timed out at 20 s, in a merge
    group of `main` plus #2193 alone.
  - The same rows passed in about 10 s in an earlier group that held a superset of that code, and in the PR's own full
    run. So it was measured as a timing flake, and the PR was re-enqueued once.
  - MERGED 01:28 UTC as `98ade6885`. Run 1369 closed.
  - Still to measure: both boxes' snapshots on the card. That waits for a release with this commit to reach the fleet.
- **2026-11-04: the operator rules on a wave 2** ("Yes: plan a wave 2 for the remaining settings").
  - **The count, measured on `main` `22d281255`:** `CCRC_SETTINGS` lists 89 names, so 82 remain after wave 1's seven:
    - test box: 44
    - graph: 23
    - session and test slices: 10
    - keepalive: 3
    - usage sweep: 1
    - carry copies: 1
  - **A read-only census** (seven Sonnet classifiers and one Opus critic) proposes one display class per name:
    - `value`: 55
    - `presence` (set or unset, and where from, never the value): 21
    - `omit`: 5
    - `origin`: 1
    It is design input, not a ruling.
  - **Run 1409** is open for wave 2, with deviation numbers 7906 to 7925.
- **2026-11-04: spec revision 5, for wave 2, is drafted on this ledger PR.** It is not approved yet. It adds section 5
  and decisions D11 to D22. The facts behind it were measured at `main` `724d7683a`:
  - the test box's host and box tables;
  - which checks can be called;
  - wave 1's strict parser, wire, card and size cap;
  - the settings census's rules.

  Three Opus lenses (leaks, facts, decisions) then checked the draft against the code. Their findings are folded in:
  - the test-box and graph rows read by literal calls and checked by `_tb_shape` and `_gr_fits`, never through the
    warning lists that quote a value;
  - a value pattern per class, checked by the server;
  - refused version-1 rows lose their value at the server;
  - value-free words for every check;
  - two decisions added: what a server-role node shows (D21), and a closed set of refusal words (D22).

  Sections 2.1 to 2.6 are marked where section 5 supersedes them. The operator rules on D11 to D22 before any plan.
- **2026-11-04: the operator approved D11 to D22 as proposed** ("Approve D11 to D22 as proposed"). Before
  recording it, the coordinator re-measured: `main` had moved four commits past `724d7683a`, none of them touching
  `ccd/`, `deploy/`, `shared/` or the update code, and `ccd/ccrc` on `main` was byte-identical to the file the census
  and the spec were measured from, with the same 89 names in `CCRC_SETTINGS`. The spec's decisions now read Agreed,
  D19 among them: the test box's address shows only whether it is set. The plan is written next, from section 5.

- **2026-11-04: D19's own item answered.** The operator ticked "Hide it: show only whether it is set (proposed)". That
  is D19 (a), already Agreed above, so nothing changed.
- **2026-11-04: wave 2's plan.**
  - Opus drafters wrote it from section 5, and an Opus critic read the drafts: 19 findings, 5 of them blocking.
  - After the coordinator's rulings, three Opus lenses (leaks, facts, executability) read the assembled plan, each
    finding with Sonnet refuters, and all 43 findings were folded in.
  - The plan has eight tasks in commit order. Deviation numbers 7906 to 7919 were assigned, and 7920 to 7925 kept
    spare.
- **Leaves under other programmes' claims.** Each was measured disjoint before it was asked for. The worker took no
  claim, edited only the named hunks, and named each leave in the PR body.
  - The delegation broker granted these:
    - `ccd/ccrc`'s settings hunks;
    - the box-settings block of `shared/api.ts`;
    - one usage pin in `install-census.test.ts`;
    - `pwa/src/fleet/fleet.css`.
  - Desktop polish granted `ccd/ccrc-doctor-checks`, under two claims in turn. Its condition: `_check_snapshot-posture`,
    its closing brace and the blank line after it stay untouched.
  - Landing order granted README's box-settings sentences, the timer row and the node-file lines, but not the
    session-gate paragraph.
  - On 2026-11-05, for fix round 1, the delegation broker granted README's box-settings sentences and
    `BOX_SETTING_ORIGIN_SHAPE` in `shared/api.ts`.
- **2026-11-04 08:32 UTC: wave 2 dispatched as run 1409.** Routing: Opus high, Sonnet high subagents, workflows off,
  compaction at 40. The plan's eight tasks are the run's eight items.
- **Rulings during the build:**
  - **D-7920 (Task 3).** The settings census refuses any line that holds a setting beside `BOX_ENV_FILE`, so the plan's
    one-line masks failed it. The mask now stands on its own line, as the first statement of one subshell. The
    census was not edited.
  - **D-7921 (gate sweep).** The census holds TypeScript's `presence` words at 20, because in TypeScript `presence`
    names a session's presence only (#1371). So the class token is `is-set` in the code and its data. The census was
    not edited, and spec revision 6 records the name.
- **Merges of `main` into the wave branch: two, and no rebase.**
  - `89f7883ae`, the worker's own clause-16 absorb: main's spawn-group pin (#2238) was red on the PR and green on
    `main`. Six timed spawns moved to `spawnSyncGroup`.
  - `891d74e3e`, on the coordinator's word: main's new shellcheck ratchet (#2291) counted five new findings in
    `ccd/ccrc`. Two assignments were quoted, and three directives carry their reasons. The baseline is untouched, and
    `ccd/ccrc` stays at its pin of 178.
  - Review 1487 measured both merge commits as equal to Git's automatic merge tree.
- **macOS.** macOS gates nothing.
  - Two commits changed tests only (`fa4bd00df`, `3231cb2b5`), so they expect `main`'s launchd reading rule on macOS.
    Every leak assertion still runs on both platforms (review 1487).
  - `box-settings-table.test.ts` has never run on macOS. Its leg hit the 55-minute limit in both runs, and
    `macos.yml`'s `workflow_dispatch` takes no file list. Review 1487 read its bash regexes as POSIX ERE that macOS
    reads as glibc does.
  - The full run's other macOS red, in `ledgers-secrets.test.ts`, came from #2260: two names that differ only by case,
    on a file system that folds case. It is fixed in #2286 and is not this programme's.
- **Review 1487 (round 1, at `891d74e3e`): sent back.**
  - **F1:** the sentence "every commit green" was false. The census red from Task 3 to the rename, and the slice-limits
    row red from Task 5 to its fix. The record now says so.
  - **F2:** the card's how line claimed more than the view does. It now says what this view reads.
  - **F3 → D-7922:** an existing slice-limits assertion was rewritten as set equality over every literal read, with a
    control row. Both of its mutants were measured.
  - **Also fixed:**
    - the shellcheck reasons;
    - a sweep's message when its settings library lacks a words function;
    - an unreachable resolver arm, which now returns "could not be checked";
    - three plan wordings.
  - **V10:** the plan's check of each consumer's read counts as met, because each consumer reads its key with the same
    call as the verb.
  - **A residual it measured:** a token pasted as the release base without a scheme showed as `custom <token>`. `main`
    already did the same. Hiding the host of a scheme-less base would change wave 1's agreed behaviour, so it went
    to the operator as item 41.
- **2026-11-05: the operator answered item 41:** "Show `custom` alone without a scheme: a scheme-less mirror loses its
  host in the view, and nothing pasted there can show". It was folded into fix round 1 as **D-7923**.
  - The verb and doctor test the raw value's scheme at their callers, and `_upd_url_origin` is unchanged.
  - The envelope requires the scheme, byte-equal in bash and L0.
  - A version-1 row of that shape reads `unmeasured`.
- **Review 1496 (round 2, at `b313d2b7c`): sent back.**
  - **F1:** doctor's scheme gate had no row that went red without it, because the envelope backed it up for every
    value planted. Plants with userinfo before a scheme now pin it.
  - **F2:** the mutation table now records D-7923's three mutants.
  - **F3, the coordinator's error:** round 1's ruling listed `CCRC_TEST_PRESSURE_MAX` among the settings an update
    installs. In fact `ccrc test` reads it on every run. The card now says so.
  - **F4:** scheme-ful twins guard the port arm and the host class again.
  - **F5 and F6:** stale records and wording.
  - **Accepted:** a scheme-less version-2 origin drops the whole document. That is the server's existing treatment
    of any version-2 row outside its class (D-7913), not the `unmeasured` the addendum expected.
- **Review 1500 (round 3, the cap, at `b0cf9a36e`): accepted.**
  - Six minor, advisory findings, none critical or important. The reviewer reproduced each mutant at the tip: verb
    gate 8 rows red, doctor gate 3, scheme 5.
  - The reviewer ran the three Opus lenses without a separate Sonnet refute pass, and re-measured each minor finding
    by hand instead. A minor finding never fails a wave on its own, so this did not change the outcome.
  - F1, F2, F3 and F5, which are plan records, are corrected on this ledger PR. F4 and F6 go under Later.
- **2026-11-05: landed.** Landing verdict ROUTE Q.
  - CodeQL alert 264 (`js/redos`) flagged a test regex in `box-settings-table.test.ts`, and the unresolved thread
    blocked the queue. The regex parses the repository's own `ccd/testbox-knobs` inside a unit test, so it was
    dismissed as used in tests. A rewrite without the ambiguity goes under Later.
  - Enqueued with `--match-head-commit b0cf9a36e`. MERGED 08:44 UTC as `42f57f9ef`. Run 1409 closed as the final wave.
  - Deviation numbers 7906 to 7923 are used, each defined once. 7924 and 7925 are spare and unused.
  - **Rollout:** `ccrc rollout --server-first`, because the server must read version 2 before a node writes it.
  - **Still to measure:** both boxes' snapshots on the card, once a release with `42f57f9ef` reaches the fleet.

## Carried constraints

- No default, range, reader, validator or refusal of any setting changes. No act reads the snapshot.
- No route, agent op, exec-whitelist entry or box-token door is added.
- The snapshot never holds a host, a home path, a credential or an unredacted URL.
- A release base with no `http://` or `https://` scheme shows `custom` alone (item 41, D-7923).

## Next-wave brief

None: wave 2 was the last wave. The programme closes once a release with `42f57f9ef` reaches the fleet and both
boxes' snapshots show on the card, measured from the console. Roll it out with `ccrc rollout --server-first`.

## Later

- The verb's absence list for the userinfo-before-a-scheme plants gains `u:pw` (review 1500 F4).
- The card's how line names the four graph settings the installer renders, not every graph setting. It scopes its
  word "only", and its pin asserts that the old clause is gone (review 1500 F6).
- The CodeQL-flagged test regex in `box-settings-table.test.ts` gets the unambiguous form
  `CCRC_[A-Z0-9_]+(?:\|CCRC_[A-Z0-9_]+)*`.
- A macOS run of `box-settings-table.test.ts`, once its macOS leg fits the job's time limit.
- The wave's own list, in the plan's Later section: doctor's rc 2 remedy for an unloadable library, the human form's
  480 against the JSON's 240 cut, V10 re-running the verb's own reads, and `rowOfV2`'s whole-set why check.
- The spec's Later list stands.
