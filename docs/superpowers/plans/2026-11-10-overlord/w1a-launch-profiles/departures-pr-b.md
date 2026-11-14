# W1a launch profiles, PR B: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-launch-profiles.md`'s "Deviations found" and the index plan. PR B
is Tasks 5 to 8, plus the carries the brief named (review 1945 F2, review 1970 N1 to N3, the W3 steering cohort, review
2004's notes). Each departure is named by its plain-words slug; no number is taken here.

**Why a new file.** The brief names `departures.md`, PR A's note. `ledger-guard` fails a pull request that modifies an
existing file under `docs/superpowers/plans/`, so PR B's departures are this new file beside it.

**Growth** (the growth check, armed, against the merge base): `ccd/ccd` +4, `server/src/coord/routes.ts` +25,
`server/src/watch.ts` +23, `server/src/coord/store.ts` +22, `ccd/ccrc-doctor-checks` +36 (limit 40 each). No waiver.

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
  - **The oracle** now compares where Claude Code fires (the variable, capped at the window, minus 33,500), not the
    variable: it must be above the hard cap and at or after the compact point, for every window from 100k to 3M. Two new
    mutants: the buffer dropped (T9) and the buffer at 33,000 (T10). Both are killed.
  - **C39's amendment, for the spec (the spec is claimed by the spec-timers piece, so the text is here):** in place of
    "set to the same figure", read: *"Claude Code's own auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`) is the
    compact point plus the buffer Claude Code keeps below that variable, measured at 33,000 to 33,500 tokens on 2.1.325
    and taken as 34,000, so Claude Code fires at the compact point, above renewal's hard cap."*
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
  carrying a steer marker. If it is ever reached, the fix is one condition: the hook's role section stays silent on a
  `manual` trigger, where ccd already typed it.

## New departures

- **steered-sessions-skipped-whole.** The brief asks the lane to keep `compactwindow` off the W3 cohort's routes. The lane
  skips any session carrying `~/.ccrc/history/steer-on/<id>` WHOLE (no field at all), and one whose marker could not be
  read too, so arming the lane changes nothing for a session in a steering experiment. It reads the file the session
  hook's W3 gate reads, by its physical name only: a link counts as present here (the hook ignores a link), the safe
  direction. The directory is spelled once more in `server/src/continuity/profileLane.ts` (`HISTORY_STEER_ON_DIR`), held
  equal to `ccd/history/lib.mjs`'s `SWITCHES.steerOnDir` by the lane's suite, since server code does not import that file.
  The marker is read only for a session the lane would write.
- **profile-lane-in-the-watcher.** The plan says to wire the pass in `server/src/index.ts`. It is wired in
  `server/src/watch.ts` (`sweepLaunchProfile`, beside `sweepGenerations`), as every lane is, on its `LANE_SCHEDULE` row
  `launchProfile` (the usage lane's cadence by reference, one pass at a time). It takes `Deps.time` there: the usage read's
  freshness is measured on the time ports' wall clock.
- **no-cap-word-the-lane-call-is-its-own (PR A's open question, ruled here).** No `ccd caps` word is added. An older fleet
  ccd refuses the three fields by name, the whole call, before any write; the lane's call carries only its own fields, so
  that refusal loses nothing else. It counts as a failed write and is logged naming the session, retried next pass. Rollout
  moves the fleet box first, so the window is short.
- **intent-unmeasured-reads-plain.** The lane asks `roleOf` with the declared-intent fact unmeasured, as the generations
  lane does. A session with no open run therefore reads `coordinator-or-plain` and takes `plain` (C49, the member that
  does less): its memory follows the Settings row until it opens a run. A coordinator between runs is plain to this lane.
- **automem-left-when-the-row-is-unread.** If the Settings row cannot be read, or holds a word this build does not know,
  the lane writes a plain session's `profile` but leaves its `automem` as it is (counted and logged), rather than guess.
- **shadow-log-on-change.** The plan says the pass logs its counts once a pass. It logs its one line only when the line
  differs from the last one it logged, so a settled fleet logs once, not every minute; a failed write is logged every pass.
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
  after #2794 merges, with no `pwa/` path (`shared/switches.ts` and `server/test/switches.test.ts`'s pins only).
- **door-census-sites.** Task 6 names `box-token-census.test.ts`'s `SESSION_ONLY`; that set lives in
  `coord-pause-route.test.ts`, and the census checks `CLAUDE.md`'s sentence against it (now "seventeen"). The door also took
  rows in `auth-gate.test.ts`'s counts (and the count in `server/src/auth/gate.ts`'s docstring), `secret-mask.test.ts`'s GET
  list, `coordinator-skill.test.ts`'s unnamed operator doors, and the Settings page's two card pins in the PWA.
- **doctor-paths-by-account.** The check names each directory as `<account>/projects/<slug>/memory` (the roster account and
  the project slug), not as a path under the home, so a line names no absolute path. Its table entry rides the
  `credentials` line, so no later line of the check table moves.
- **review-1970-N1-N3, done.** N1: `_profile_spawn_compose` journals `_route_unread_note`'s line for a `.profile` present
  but unreadable (a link, mode 000) and `_route_reject_note`'s for a word that is not a row or bytes of no word's shape;
  `_route_get` and its E0c closure are untouched; two `contexts-edges.tsv` rows. N2: `routeParseWhy` in `shared/api.ts` is
  the one spelling of the refusal suffix, used by `routeParseDetail` and `parseRouteRequest`. N3: the docstring names the
  lane-only refusal.
- **migration-slot-69.** Measured on `origin/main` at 68 before this PR; re-measure before merge (card PR B may take a
  slot too, and the second to land merges `main` once).

## Shared files (peer consent, second to land merges `main` once and keeps both)

Card PR B (run 2018) holds the shared registries this PR adds rows to: `server/src/coord/schema.ts`, `store.ts`,
`server.ts`, `auth/gate.ts`, `CLAUDE.md`, the census suites, `rings/fastify-l4.data.ts` and `mutation-floors.json`. Asked
by mail; each edit is a separate line. Card PR B adds its own rows to `mutation-floors.test.ts` and
`coord/ports.ts`, held here, with this PR's consent.

Seen, not fixed: `server/test/sim/mutation-floors.json` carries the `compactThresholdFor` key twice (a merge's union; JSON
keeps the last, which is equal). Left for the ledger PR.
