# W1a launch profiles, PR B: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-launch-profiles.md`'s "Deviations found" and the index plan. PR B
is Tasks 5 to 8, plus the carries the brief named (review 1945 F2, review 1970 N1 to N3, the W3 steering cohort, review
2004's notes). Each departure is named by its plain-words slug; no number is taken here.

**Why a new file.** The brief names `departures.md`, PR A's note. `ledger-guard` fails a pull request that modifies an
existing file under `docs/superpowers/plans/`, so PR B's departures are this new file beside it.

**Growth** (the growth check, armed, against the merge base, after fix round 2 and its merge of `main` at 44f68ea36):
`ccd/ccd` +6, `server/src/coord/routes.ts` +25, `server/src/watch.ts` +23, `server/src/coord/store.ts` +22,
`ccd/ccrc-doctor-checks` +40 (limit 40 each). No waiver. The doctor file is at its limit: a further line there needs one
removed.

**Fix round 1 (review 2024, the coordinator's rulings).** Each finding's change is named in the slug it touched below; the
slugs this round added or replaced are `compact-owned-while-continuity-live` (F3), `undecided-role-is-skipped` (F2 a, b,
replacing `intent-unmeasured-reads-plain`), `compaction-cleared-on-a-role-without-it` (F2 c), `failed-writes-do-not-count`
(F12), `doctor-second-memory-walker` (F5, F6) and `no-overlord-profile-before-w1` (F13 c).

**Fix round 2 (review 2031, the coordinator's rulings).** F1 tightens the steer-marker grant
(`steered-sessions-skipped-whole`); F2 is the migration move (`migration-slot-70`, which replaces `migration-slot-69`);
F3 widens what the doctor reads as unmeasured (`doctor-second-memory-walker`); F4 corrects the band's comment
(`compact-window-carries-the-buffer`). Nits taken: `cmd_route`'s header says an empty compaction value clears it, the
scratch census names `_dr_mem_is_scratch`, and the band is stated as the 10-point profile's. Nits recorded, not changed:
under `slight-nits-recorded`.

## Measured for the brief

- **compact-window-carries-the-buffer (review 1945 F2), a change to Task 4's figure.** Claude Code fires its
  auto-compaction a fixed number of tokens below `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, whatever the variable is set to.
  - **How measured:** Claude Code 2.1.325, the W0 delegation rig against its mock API, a PreCompact hook that refuses
    `trigger: auto` (so each turn's start asks again), and each turn's reply reporting more input tokens than the last.
    - Variable 120,000 (what PR A wrote for a 200k window): no PreCompact after a turn at 86,000; one after 87,000.
    - Variable 200,000: none after 166,500; one after 167,000.
  - **Result:** the buffer is between 33,000 and 33,500 tokens, absolute, not a share of the window. So PR A's 120,000 for
    a 200k window fired near 87,000, under the 100,000 hard cap: C39 inverted.
  - **The fix:** `compactThresholdFor` adds `AUTO_COMPACT_BUFFER_TOKENS` = 34,000 (the measured bound, rounded up) to the
    compact point. A 200k window now gets 154,000 (it fires at about 120,000, its 60% point), and a 1M window 384,000 (it
    fires at about 350,000). ccd's own `compact` percent is unchanged.
  - **The band (review 2024 F4).** The variable is clamped to the range it takes (100,000 to 1,000,000), so on a window
    under 85,000 tokens Claude Code would fire before the compact point (at 64,000 it fires at about 30,500, under the
    32,000 cap), and over 6,900,000 the upper clamp fires it early too. `compactThresholdFor` now answers `null` wherever
    the firing point, the variable capped at the window less 34,000, falls before the compact point: for the shipped
    10-point profile (`LONG_LIVED_COMPACTION`), exactly outside 85,000 to 6,900,000 tokens; a profile with another step has
    its own band. Real windows (200k and 1M today) are well inside it. For a role with a compaction column, `null` means
    the lane writes no compaction field and leaves the route's earlier ones (review 2031 F4; a lane case covers 50,000 and
    10,000,000): the earlier pair came from the same function in band, so it still honours C39, where a clamped write
    would fire early.
  - **The oracle** compares where Claude Code fires (the variable, capped at the window, minus 33,500), not the variable:
    for every window from 1,000 to 12,000,000 tokens, the answer is `null` exactly outside the band, and inside it the
    firing point is above the hard cap and at or after the compact point. Mutants: the buffer dropped (T9), the buffer at
    33,000 (T10), the band's guard dropped (T11), and the guard ignoring the window (T12). All are killed.
  - **C39's amendment, for the spec (the spec is claimed by the spec-timers piece, so the text is here):** in place of
    "set to the same figure", read: *"Claude Code's own auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`) is the
    compact point plus the buffer Claude Code keeps below that variable, measured at 33,000 to 33,500 tokens on 2.1.325
    and taken as 34,000, so Claude Code fires at the compact point, above renewal's hard cap. This holds for windows from
    85,000 to 6,900,000 tokens, where the variable's range (100,000 to 1,000,000) still reaches the compact point; outside
    them no compact point is written."*
  - **Re-measure** on a new Claude Code build before the `continuity` row goes live; the scenarios are two small rig
    files (one turn per usage step, PreCompact refusing auto), not committed.
- **compact-text-typed-whole (review 2004's note).** The longest role text, the overlord's (568 characters), typed as
  `/compact <text>` with `tmux send-keys -l`, then Enter after a second (ccd's `_auto_compact_check` path), on Claude Code
  2.1.325 in the rig: the input line showed the text verbatim, wrapped over three lines, with no paste placeholder, and both
  summarising requests carried it verbatim. The pane was 200 columns wide; a narrower pane only wraps more.
- **role-text-twice-while-steered (review 2004's note), acceptable and not reached.** With W3 steering armed, a session
  whose route carries `compactwindow` would get its role text twice: ccd types it after `/compact`, and the hook's
  PreCompact print adds the role section before the steer text. The two copies are the same words; the cost is about 400 to
  570 characters in one summarising request, and the keep-list reads the same either way. It is not reached from this PR:
  the lane writes `compactwindow` only while `continuity` is live (gated until the renewal act), and it skips every session
  carrying a steer marker. One gap stays open (review 2024 F13 b): a session given `compactwindow` BEFORE its steer marker
  appeared keeps it, because the lane skips a steered session whole, clearing included. That too needs `continuity` live,
  which the renewal act brings, after the cohort's bound. If it is ever reached, the fix is one condition: the hook's role
  section stays silent on a `manual` trigger, where ccd already typed it.

## New departures

- **steered-sessions-skipped-whole.** The brief asks the lane to keep `compactwindow` off the W3 cohort's routes. The lane
  skips any session carrying `~/.ccrc/history/steer-on/<id>` WHOLE (no field at all), and one whose marker read answered
  anything but a proven absence (review 2024 F11: `steer !== 'absent'`, so a later read-failure word skips too), so arming
  the lane changes nothing for a session in a steering experiment. The marker is read only for a session the lane would
  write, through `steerMarkerOf` (`profileLane.ts`). The directory is spelled once more, in `shared/agent-protocol.ts`
  (`HISTORY_STEER_ON_DIR`, which the agent and the server both read), held equal to `ccd/history/lib.mjs`'s
  `SWITCHES.steerOnDir` by the lane's suite, since neither package imports that file.
  - **The agent admits that one path for `stat` (review 2024 F1).** In remote fleet mode the read crosses the agent link,
    and the agent's `stat` admitted only its read roots and three `~/.ccrc` switch files, so every marker read answered
    `forbidden`, read as unreadable, and the shadow count read every session that needed a write as skipped.
    `checkSteerOnStat` (`agent/src/whitelist.ts`) now admits `<canonical ~/.ccrc>/history/steer-on/<registry id>` for `stat`
    alone. **Legitimately different** from `checkPath`'s roots, and kept out of them: it is another host's file, read by
    the server across the link, and it answers one marker's existence, size and time; `read`, `readdir` and `lstat` admit
    none of it and the directory stays unlistable. A live link at a marker is refused (the server reads it unreadable and
    skips the session); a dangling one answers absent, as the hook's test does.
  - **Tightened (review 2031 F1).** `~/.ccrc` may be a link, followed as the sibling grants follow it; under it,
    `history` and `steer-on` must each be a real directory or absent (`lstat`): a link or a file at either level is
    refused, so the grant cannot be pointed at another directory. The expected directory is built from the canonical
    `~/.ccrc` and the literal level names, so a linked level also fails the parent check; the `lstat` is what refuses a
    file there (each case has a test, and each line's mutant is killed). A hard link at a marker's name cannot be
    detected (same user, who could read its target anyway); the docstring says so. `agent/CLAUDE.md` names the grant
    beside D-8382's.
  - **Measured end to end.** `continuity-profile-watcher.test.ts` drives the watcher's real `sweepLaunchProfile`: the path
    asked of the fleet io, a marker on disk (skipped), an unreadable answer and a throw (skipped as unread), and absence
    (counted). Replacing the watcher's read with `async () => 'absent'` turns all three cases red (measured). The agent's
    suites hold the grant (`whitelist.test.ts`, `fileops.test.ts` over the socket); dropping it from the `stat` op, or the
    registry-id check, turns them red (measured).
- **profile-lane-in-the-watcher.** The plan says to wire the pass in `server/src/index.ts`. It is wired in
  `server/src/watch.ts` (`sweepLaunchProfile`, beside `sweepGenerations`), as every lane is, on its `LANE_SCHEDULE` row
  `launchProfile` (the usage lane's cadence by reference, one pass at a time). It takes `Deps.time` there: the usage read's
  freshness is measured on the time ports' wall clock.
- **no-cap-word-the-lane-call-is-its-own (PR A's open question, ruled here).** No `ccd caps` word is added. An older fleet
  ccd refuses the three fields by name, the whole call, before any write; the lane's call carries only its own fields, so
  that refusal loses nothing else. It counts as a failed write and is logged naming the session, retried next pass. Rollout
  moves the fleet box first, so the window is short. The same holds for a clear (an empty compaction value), which an
  older ccd refuses as a bad value.
- **undecided-role-is-skipped (review 2024 F2 a, b; replaces `intent-unmeasured-reads-plain`).** An unmeasured fact is never
  written as a definite value. The lane reads declared coordinator intent from the delegation checkpoint
  (`coordinatorIntentByParent` on the registry incarnation), as card PR B's fix round does, through ONE reader:
  `server/src/continuity/declaredIntent.ts` (`intentOfCheckpoint`), a file both PRs carry byte for byte (agreed with
  card B, mail 19361), so whichever lands second merges it as the same file. Each keeps its own fold of the incarnation
  (`declaredIntentOf` in `profileFor.ts` here: absent reads declared none, unreadable is unmeasured). So: a non-child that
  claims an open run is a coordinator (its intent is not read); one that claims none is a coordinator if it declared
  intent, and plain if the checkpoint measurably holds none; one whose intent is unmeasured (incarnation unreadable,
  checkpoint not ready), and EVERY non-child while the open-coordinator set cannot be read, is skipped and counted
  (`roleUnread`, "whose role could not be decided"), never written. A coordinator between runs that declared its intent
  keeps memory off; one that did not is plain and follows the Settings row (the item says so in option 1).
  `PROFILE_OF_UNDECIDED` still answers for `worker-or-reviewer` (an unreadable child mark reads `worker`, C49);
  `coordinator-or-plain` no longer reaches `profileFor` from the lane.
- **compaction-cleared-on-a-role-without-it (review 2024 F2 c).** When a session's role has no compaction column, the lane
  clears `compactwindow` (its field alone) and, while `continuity` is live, `compact` too, rather than leaving them for a
  role that has none (ccd would still send the window variable while dropping the coordinator's idle-compaction setting).
  ccd had no way to remove a route field, so `ccd route --set compact=` and `--set compactwindow=` now delete the field
  (`cmd_route`, journalled `<old> -> ∅`); every other field still refuses an empty value. A field already absent is left
  alone, so a settled route sends nothing. An older fleet ccd refuses the empty value, which counts as a failed write.
- **compact-owned-while-continuity-live (review 2024 F3, carried).** `compact` is not lane-only: the operator's route and the
  coordinator's `POST /api/runs/:id/route` still write it, and while `continuity` is live the lane rewrites it to the
  profile's percent on its next pass, undoing a hand-set value. That is the plan's rule (the lane owns the compaction
  columns while `continuity` is live). The doors' refusal of `compact` while `continuity` is live is built with the renewal
  act, which lifts the `continuity` gate; until then `continuity` cannot be live, so no hand-set value is undone.
- **automem-left-when-the-row-is-unread.** If the Settings row cannot be read, or holds a word this build does not know,
  the lane writes a plain session's `profile` but leaves its `automem` as it is (counted and logged), rather than guess.
- **shadow-log-on-change.** The plan says the pass logs its counts once a pass. It logs its one line only when the line
  differs from the last one it logged, so a settled fleet logs once, not every minute; a failed write is logged every pass.
- **failed-writes-do-not-count (review 2024 F12).** The cap is five SUCCESSFUL writes a pass: a failed write no longer
  counts, so rows failing at the head of a stable order cannot starve the rest (a one-line change, so made). The cost: on
  an older fleet ccd, which refuses every row alike, each pass tries every row that needs a write and logs a failure line
  for each, until the fleet box is updated (rollout moves the fleet box first).
- **no-overlord-profile-before-w1 (review 2024 F13 c).** `roleFactsOf` fixes `designation` at `none` until W1 brings its
  reader, so the lane never writes the `overlord` profile, and the Overlord's own switches (forks and agent view off) are
  not applied by this PR. Intended: W1 creates the designation, and the item says those switches apply once W1's Overlord
  exists.
- **not-ran-is-unmeasured.** A route write whose ccd call never ran (the agent link dropped) is logged as unmeasured, never
  as ccd's refusal (the consolidation census's `ran` rule).
- **plain-memory-l0-file.** The Settings row's choices, default, wire view and words live in `shared/plainAutoMemory.ts`
  (L0, no imports), the `lane-arm.ts` shape; `plainAutoMemoryOf` (L1) sits beside `profileFor` and joins `MUTANT_SETS`.
- **switchboard-row-follows (the coordinator's ruling on this PR).** Task 6's `SWITCHES` row `plain-auto-memory`
  (`shared/switches.ts`, storage `plain_memory_settings.choice`, default `off`, owner C3, writer
  `POST /api/coord/plain-auto-memory`) is NOT in this PR: `consolidation-path-guard` (D-5855) refuses a diff that touches
  `shared/switches.ts` and `pwa/` together, and this PR needs `pwa/` (the Shadow lanes entry ships with its lane-arm row, or
  the PWA does not compile). It follows in a small PR of its own after this one merges, as the dispatch-abandon switch's
  row did (#1965). Nothing requires a setting-backed switch to have a row, so this PR is complete without it.
  **Nothing in this PR reads that row** (the ruling's first condition). The setting is read from `plain_memory_settings`
  only, by the store (`CoordStore.plainAutoMemorySettings`), and its readers read the store: the lane (through
  `plainAutoMemoryOf`), the door, and the PWA card (through the door). No file indexes `SWITCHES` for it. So the row's
  absence changes no answer: there is nothing that could read it as on or as a silent off. Pinned by
  `plain-auto-memory-route.test.ts` ("nothing reads a switchboard row for this setting"), which goes red when a reader
  of the setting names `SWITCHES` in code, measured. **Owed:** the row, in one small follow-up PR from this workspace
  after #2794 merges, with no `pwa/` path: `shared/switches.ts`, `server/test/switches.test.ts`'s pins, and
  `server/test/plain-auto-memory-route.test.ts` (review 2024 F7: the row names the setting, `plain_memory_settings.choice`
  and `SWITCHES` itself, so that test exempts `shared/switches.ts` from its no-`SWITCHES` assertion and adds it to the
  `plain_memory_settings` allow-list; a generic reader that walks every row without naming this one would pass it unseen).
- **door-census-sites.** Task 6 names `box-token-census.test.ts`'s `SESSION_ONLY`; that set lives in
  `coord-pause-route.test.ts`, and the census checks `CLAUDE.md`'s sentence against it (now "seventeen"). The door also took
  rows in `auth-gate.test.ts`'s counts (and the count in `server/src/auth/gate.ts`'s docstring), `secret-mask.test.ts`'s GET
  list, `coordinator-skill.test.ts`'s unnamed operator doors, and the Settings page's two card pins in the PWA.
- **doctor-paths-by-account.** The check names each directory as `<account>/projects/<slug>/memory` (the roster account and
  the project slug), not as a path under the home, so a line names no absolute path. Its table entry rides the
  `credentials` line, so no later line of the check table moves. The slug is Claude Code's working-directory slug, so in
  local doctor output it can carry an encoded home path (review 2024 F13 f); nothing shipped carries it. README's checks
  table and its server-role skip list name the check (F10).
- **doctor-second-memory-walker (review 2024 F5, F6).** `auto-memory` is a second walker of `projects/*/memory` beside
  `memory`. **Legitimately different:** `memory` asks whether each project's memory is linked to its one store (forked or
  not); `auto-memory` asks which directories hold files the lane would stop loading. They share the scratch-slug skip
  (`_dr_mem_is_scratch`, the doctor file's one spelling of that pattern, so the three-site census still holds), so the two
  never disagree about which directories count. `auto-memory` is now measured or says it is not: a `projects/`, project
  directory or memory directory it cannot list, or a walk past the transcript walk's 20 s deadline, is WARN unmeasured,
  never PASS (an unreadable directory once read as "none"). Removing the memory directory's listable test turns its new
  case red (measured).
  - **Review 2031 F3.** A config directory it cannot search is unmeasured (it once read as "no `projects/`"), and so is a
    `memory` LINK it cannot follow (normally a link into `~/.ccrc/memory/<slug>`; a target behind an unsearchable
    directory once read as "no directory"). A link to nothing or to a file is skipped, told apart by `cd`'s own reason
    under `LC_ALL=C`. A test covers the link shapes and the unsearchable config dir; it is red on the round-1 check.
    `transcript_work` keeps the config-directory blind spot; that is its own check's, not this PR's.
- **review-1970-N1-N3, done.** N1: `_profile_spawn_compose` journals `_route_unread_note`'s line for a `.profile` present
  but unreadable (a link, mode 000) and `_route_reject_note`'s for a word that is not a row or bytes of no word's shape;
  `_route_get` and its E0c closure are untouched; two `contexts-edges.tsv` rows. N2: `routeParseWhy` in `shared/api.ts` is
  the one spelling of the refusal suffix, used by `routeParseDetail` and `parseRouteRequest`. N3: the docstring names the
  lane-only refusal.
- **migration-slot-70 (review 2031 F2; replaces `migration-slot-69`).** Card PR B (#2793) merged first with migration 69 (the
  card door's tables), so this PR merged `main` once (at 44f68ea36) and its entry is 70, after card B's. Moved, every site:
  `server/src/coord/schema.ts`'s banner `── 70: user_version 69 -> 70` (the banner `coord-db.test.ts` holds as
  `[i+1, i, i+1]`, so a stale one is red), its notes (`user_version 70`, "must print 69"); `coord-db.test.ts`'s version
  pins (two `COORD_SCHEMA_VERSION` and `MIGRATIONS.length`, now 70) and its two `MIGRATIONS[69]` comment lines;
  `run-close-switch.test.ts`'s rewind (its comment names 70, 69 and 68, the `DROP TABLE` list carries both PRs' tables,
  and the count reads seventeen); the route counts (`server/src/auth/gate.ts`'s docstring 226, `auth-gate.test.ts`'s
  `ROUTES` 229, its HTTP-route comments 226, exempt 85). A new test holds the order: card B's entry is 69 and this one
  70 (swapping them turns it and the banner test red, measured). `declaredIntent.ts` merged as one file, byte-identical.
- **slight-nits-recorded (review 2031).** Not changed: `--set compact= --apply` from a hand shell writes `compact=` into
  `routeapplied` (reads back empty, harmless); once `continuity` is live, clearing `compact` on a session whose only
  routing field it was makes `_route_any` false, so that session's next operator spawn seeds the default routing row, as
  for any never-routed session; README's route section does not yet say an empty value clears (`cmd_route`'s header
  does); the incarnation fold is written twice, here and in the card's gatherer (a merge candidate now both are on
  `main`); the Settings card reads the lane's state once, at mount.

## Shared files (peer consent, second to land merges `main` once and keeps both)

Card PR B (run 2018) holds the shared registries this PR adds rows to: `server/src/coord/schema.ts`, `store.ts`,
`server.ts`, `auth/gate.ts`, `CLAUDE.md`, the census suites, `rings/fastify-l4.data.ts` and `mutation-floors.json`. Asked
by mail; each edit is a separate line. Card PR B adds its own rows to `mutation-floors.test.ts` and
`coord/ports.ts`, held here, with this PR's consent. Card PR B has since merged (#2793). In fix round 2 the notes piece (run 2032) holds `schema.ts`, `auth/gate.ts`,
`auth-gate.test.ts`, `coord-db.test.ts`, `run-close-switch.test.ts` and `README.md`; the migration move's lines there were
named to it by mail (19426) before the push, and it adds its own rows to `mutation-floors.test.ts` with this PR's leave.

`server/test/sim/mutation-floors.json` carried the `compactThresholdFor` key twice (a merge's union; JSON keeps the last,
which was equal); fix round 1 removes one, with card B's leave (review 2024 F13 d).
