# Program: box-settings-view

Spec: `docs/superpowers/specs/2026-10-25-box-settings-view-design.md` (#1417).
Plan: `docs/superpowers/plans/2026-10-25-box-settings-view.md` (wave 1). The wave's worker committed it, with the spec,
as its PR's first commit. Wave 2's plan is not written yet.
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
| 2 | The 82 other names in `CCRC_SETTINGS`, each with a display class. | — | **PLANNED** 2026-11-04 (run 1409). Spec revision 5 (section 5, D11 to D22) approved 2026-11-04; the plan and the dispatch follow. |

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

## Carried constraints

- No default, range, reader, validator or refusal of any setting changes. No act reads the snapshot.
- No route, agent op, exec-whitelist entry or box-token door is added.
- The snapshot never holds a host, a home path, a credential or an unredacted URL.

## Next-wave brief

Wave 2: the remaining settings (run 1409, deviation numbers 7906 to 7925). The design is the spec's section 5
(revision 5, approved 2026-11-04), and where it differs from the points below, section 5 governs. The points it
settled from the census:

- **One display class per name** (`value`, `origin`, `presence` or `omit`). Free text, names, paths, globs, lists,
  user names and token or key files are `presence`.
- **Refused values.** A refused value records only its verdict and its source, never its raw text. This retires the
  A13 residual for all keys, wave 1's seven included.
- **Validated values only.** The card takes each value from its owner's own check, by calling it: `_tshape`,
  `_gr_knobs` and `_tb_load`. It never copies a regex.
- **File mode.** Every read uses `ccrc.env` alone, because an environment-first read reports the reader's own
  environment.
- **The test box.** The host table goes on the card. The box table, read only on the test box itself, is omitted on a
  console node.
- **The test-box URL.** `presence`, approved as D19: its host, a private address, never shows.
- **Settings applied at install.** Slice and graph-unit settings take effect at the next update. Either the card says
  so, or it reads the installed drop-in.
- **Doctor.** Doctor's `box-settings` check uses the same display table as the card.

Task 1 also carries review 1403's F1, F3 and F4. Wave 2 adds keys to the snapshot, so its rollout is `--server-first`
(review 1385's ruling above). The programme closes when wave 2 lands and both boxes' snapshots show on the card.
