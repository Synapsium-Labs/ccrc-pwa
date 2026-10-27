# Wave 4 PR2: notes for the ledger

The worker's notes for PR2 (the PWA's delegation rows), to be folded into the plan's "Deviations found" and the programme
ledger by the coordinator's ledger pull request. PR2 owns D-7007..D-7010. The entries below are written as prose, not as
`- **D-N**` definition lines: the plan already defines each of these numbers (as `unused`), and `deviation-refs.test.ts` reads a
second definition line as a collision.

## Deviations

- D-7007, `delegation-rows-share-two-existing-rules` (PR2 Task 2.7, found by the first full PWA run at the tip). The plan adds new
  `.proj-work*` and `.proj-group*` rules next to `.proj-pending`, and lists no census file among PR2's files. As written, three
  censuses went red, each on a copy the new rows made: `shape-census` (`.proj-work` declared `.proj-pending`'s seven declarations,
  and `.proj-group-toggle` the fold toggles' seven), `markup-census` (the worktree row rendered the session row's works-on chip
  block a second time) and `contrast` (four new colour rules with no ground). Each copy now has one owner: `.proj-work` joins the
  `.proj-pending` rule and `.proj-group-toggle` joins the `.proj-released-toggle, .proj-archived-toggle, .proj-children-toggle`
  rule (two selector lines added to existing rules in `fleet.css`, not purely new rules), and `WorksOnChip` in `SessionLine.tsx`
  is drawn by both rows. The registries follow the rekeyed rules, in three files outside the plan's list: `pwa/design/audit.mjs`
  (the ground of `.proj-pending, .proj-work`, `.proj-work-parts > *:not(:first-child)::before` and `.proj-work-chip`, and the
  toggle rule's rekeyed entry), `pwa/test/contrast.test.ts` (`.proj-pending` leaves the grandfathered blind spots, since its rule
  is now registered) and `pwa/test/role-census.test.ts` (`'.proj-pending, .proj-work': META`). `fleet.css` still names no broker
  word, and no shipped colour or token changed.
- D-7008, `the-header-draws-the-r9-chip-too` (PR2 Task 2.8). The plan has `SessionMeta`'s card mode draw the chip, and the header
  hold it through `headerFacts`. `headerFacts` has no rendered reader, so the rendered session header would have lacked a fact
  the card shows, against D-5545's rule that the header is a superset of the card. `SessionMeta`'s header mode draws the same
  `.sess-meta-chip` after the subagent tally, pinned by the row "the rendered header draws the chip the card draws" in
  `card-header-facts.test.tsx`.
- D-7009, `characterisation-pins-fingerprints` (PR2 Task 2.3, W4-U0). The plan compares each `JSON.stringify` output with "an
  inline expected string captured on `main`". The three files make 70 calls whose outputs carry whole `FleetSession` rows, so
  the full strings would add thousands of lines. Each file instead records every call its cases make (inputs and the output's
  JSON, `pwa/test/characterise.ts`) and pins the first 16 hex digits of each output's SHA-256 as an inline snapshot, captured on
  `main`'s code before any source edit. A key-order change to one `nestFleet` row reds all three files. The null-argument twins
  (W4-U11, U19, U23) replay the recorded inputs and compare the full JSON string, not the fingerprint.
- D-7010, `the-wave-3-health-row-narrowed-to-w4-pwa-files` (PR2, found by CI's `server 1/12` at d3a88e8eb; licensed by the
  coordinator for ask 142, which also names it a plan gap rather than a departure by this PR). Wave 3's row in
  `server/test/fleet-health.test.ts` (Task 13, "adds no PWA state and no fleet frame") grepped `pwa/src` for
  `/DelegationObservationHealth|\.delegation\b/`. It was meant to keep the `/api/fleet/health` member out of the PWA, but it cannot
  tell that member from the frame's store slot `FleetState.delegation` (Task 2.1), which PR2 reads at four sites in three files,
  by design. That one row changes; nothing else in `server/` does beyond the cherry-pick:
  - `DelegationObservationHealth` stays named nowhere in `pwa/src`;
  - `.delegation` is allowed only in `W4_PWA_FILES`;
  - `W4_PWA_FILES` is a local of the scope census (PR1's, not exported and not edited), so the row mirrors the eleven paths
    literally, and checks the mirror against the census's own text so the two cannot drift;
  - a CONTROL row shows that a file outside the list naming `.delegation` is red, and so is a listed file naming the health's type;
  - the row is retitled, keeping its wave-3 reference ("wave 3 Task 13, narrowed in wave 4"), because it no longer says "no fleet
    frame".

  Four mutants each red it: dropping the allow-list clause, dropping the type ban, adding a fake file to the allowed list, and
  drifting the mirror from the census.

## Smaller notes (no number)

- Task 2.1: W4-UM1 (an empty initial slot) survived the plan's rows as first written, because every row read the slot after
  the socket opened and `onOpen` clears it. W4-U1 and W4-U4 now also read a store that has not connected (W4-U4 one hydrated
  from the offline snapshot), and W4-U27 reads the screen with sessions seeded before the socket opens. UM1 then reds all three.
- Task 2.2: `readDelegation` leaves out a member that is not an object at all (it carries no word to re-file and no key to
  render by); every object member is kept and re-filed as the plan states. It reads members with `lib/wire.ts`'s `isRecord`
  (`pwa-one-owner`).
- Task 2.4: W4-UM9 (worktree parents added to `parents`) reds W4-U13 and W4-U15. The plan also names W4-U0/U11, which carry no
  worktree and so cannot see it. In the offline group, worktrees come before activities, as W4-U16 states.
- Task 2.5: the count of activities no card can draw is `unplacedActivities` in `fleetTree.ts`, so `FleetCards` reads a
  decision rather than counting.
- Task 2.7: W4-U27 first compared the screen with a pass-through mock of `fleetTree` in `fleet-screen.test.tsx` that dropped
  the fifth argument. Fix round 1 replaced that comparison and removed the mock (F1 below).
- Task 2.8: W4-UM19's first half (drop `card.delegated` from `cardWithinHeader`) survived as the plan predicts. W4-U33 also
  feeds the predicate a header without the chip, so both halves now red it.
- Task 2.8 Step 4, the census footprint measured with the census's own regexes (comments stripped): `delegation` is named by ten
  files, all in `W4_PWA_FILES` (`SessionMeta.tsx` names none); `lease` by six of them plus main's two (`HaltBanner.tsx`,
  `updateHalt.ts`). No file outside the list.
- `server/src/watch.ts` and `server/src/coord/store.ts` are untouched (growth 0). PR2's only `server/` and `shared/` changes are
  PR1's cherry-picked Task 1.1 commit, the one-line spec citation the brief licensed, and D-7010's row.

## Fix round 1 (review 1029)

Review 1029 read the tip `8fdfb1d52`. Its held-out panel confirmed F1, and the reviewer's own mutant O4 found F2. This round
changes tests and this note only: no file under `pwa/src`, `server/`, `shared/` or any stylesheet changes, and no number is
allocated.

### F1: W4-U27 compares today's screen with the base's own render

The plan's Task 2.7 prescribed comparing each card's body with "the same render with `fleetTree` called with no fifth
argument". Both sides of that comparison ran today's code with a null frame (the argument defaults to `null`), so a
regression the two paths share left it green. That is a flaw in the prescribed oracle, not a regression found in production.
The contract it served is Review Focus 4: no frame gives the base's view, with only the declared availability mark added.

- **The world.** `pwa/test/olderServerWorld.tsx` renders one deterministic world: a quiet project, a working one, a
  coordinator whose five workers fold into one line with one of them asking, and a coordinator whose worker, a workspace of
  another project, sits on its card with the works-on chip and a programme label. It runs on `rollupFixture`'s fixed clock and
  leaves every request unanswered. It drives the store with an older server's frame sequence (hello, fleet, runs, coord, pools,
  divergence; no `delegation`). It returns four views of `document.body.innerHTML`: `cold` (rows set before the socket opens),
  `connected` (after the frames), `opened` (after project-a's card and the workers line are opened), and `instrument` (Instrument's
  fleet table over the same store). Every local import path exists at PR2's base. `shared/api.ts` and
  `pwa/src/stores/fleet.ts` changed since that base; the other direct local imports, `pwa/test/setup.ts`,
  `pwa/vite.config.ts`, and the lockfiles of `pwa` and `ui` are unchanged. Each capture uses the base's own production
  modules, not today's modules; the import paths alone do not establish unchanged behavior.
- **The baseline and how it was captured.** `pwa/test/fixtures/older-server/render-7dc486b97.json` was rendered by the
  code at `7dc486b975741a88aaecb9fb98929b44de2d681a`. The capture:
  1. extracted that commit's `pwa`, `ui` and `shared` with `git archive` into a scratch tree;
  2. linked `pwa`'s packages from this branch's install (the same lockfile) and `@ccrc/ui` to the archive's own `ui`;
  3. copied in the world module (current sha256 `53ecdf57c1a89c144a23d6168a2ffc5679182f1cba317e9ca82b3c424dc7dd73`, which the
     baseline records and W4-U27 checks);
  4. ran a one-case vitest file, never committed, that calls `renderOlderServerWorld()` once and writes what it returns.

  The first captures and mutant runs used the workspace volume rather than the required root filesystem. They are
  historical technical observations, not compliant containment evidence. Following the coordinator's correction, a new
  private root-filesystem scratch directory was created exclusively. Resolved paths and `df` proved both `TMPDIR` and
  the single source tree on the root filesystem before each run; existing dependencies were linked, not copied or installed.
  The original world (sha256 `5488ddb5f9642f6f9fc011d8fa6af825a9fcc0a8d08d63a44ad593645978c79a`) reproduced the original
  committed fixture byte for byte (fixture sha256 `28dd45117212105e9c0db1ff87e84de4fbaffe98f983ee83a0450c7d63fb80a7`).
  Only then was the world's overbroad unchanged-import comment corrected. Two fresh base-source captures with that
  comment correction were byte-identical and kept all four markup strings exactly unchanged. Only `capture` and
  `worldSha256` metadata changed (new fixture sha256 `96372d08f93ed2e174d145e3a08e20cf91520fb1bf4e184e1039a7c738c41338`).
  The old-source baseline comparison passed with no normalization; the restored current comparison passed too.
- **Normalization.** The capture applies none. W4-U27 removes only `data-delegation="unavailable"` from each
  `class="fleet-list"` element of today's render. Each view must hold exactly one such mark per fleet list in the baseline
  (1, 1, 1, 0), no other `data-delegation` attribute, and none of `inferred`, `Unowned work`, `Offline coordinator` and
  `delegated`. Then it must equal the baseline byte for byte. Today's code passes with no other difference, so nothing in
  production was changed and no expectation was re-blessed.
- **One render per file.** React's `useId` counter runs per module graph. In the scratch capture, a second render in the same
  file numbered Instrument's tab ids `_r_s_` instead of `_r_9_`, and nothing else differed. So the world is rendered once, in a
  file of its own, `pwa/test/older-server-render.test.tsx`. `fleet-screen.test.tsx` loses the old case and its pass-through
  mock. The cold-store pin is now the `cold` view, the availability pin is the per-list mark, and the forbidden words are
  checked on the markup.
- **Historical mutants**, each in the earlier non-root scratch tree at `492c059e5` and restored from a saved copy with
  its sha256 checked. W4-U27 was green before them; these observations alone do not satisfy the containment requirement:

  | Mutant | Change | W4-U27 goes red at | The former W4-U27 |
  |---|---|---|---|
  | W4-UM1 | the store's initial `delegation` is an empty frame | `cold: each fleet list reads unavailable` (0 marks, not 1) | not run |
  | W4-UM16 | `FleetCards` reads `delegation ?? EMPTY_WIRE` | the same assertion | not run |
  | F1-M1 | `ProjectCard`'s workers line draws its closed chevron as `›` instead of `▸` | `connected: the base's markup, byte for byte` | passed |
  | F1-M2 | `nestFleet` pushes a parent's children in reverse order | `opened: the base's markup, byte for byte` | passed |

  F1-M1 and F1-M2 change both of the former comparison's sides equally. The former W4-U27 is `fleet-screen.test.tsx` at
  `8fdfb1d52`, run in the same tree; it passed under both.
- **Root-contained remeasurement.** The single tree was repurposed from the exact base to `633f64450` plus the corrected
  world and capture metadata; no second active source tree was created. UM1 and UM16 each red U27's `cold: each fleet list
  reads unavailable` (0 marks, expected 1). F1-M1 changes only the workers line's closed chevron (`row.expanded`'s false
  branch, `▸` to `›`) and reds `connected: the base's markup, byte for byte`. Each mutant ran alone, then its saved
  source was restored and SHA-checked, then U27 passed (1 test). F1-M2 and the former U27 were not repeated in this corrected
  round; their earlier outcomes remain historical rather than root-contained claims.
- **Two pins, two jobs.** The 70 JSON fingerprints of D-7009 are unchanged. They pin the output of `nestFleet`, `fleetTree` and
  `rollupFleet` captured on `main`. This baseline pins rendered markup. Neither one replaces the other.

### F2: the reader at the tree's seam

Review 1029's mutant O4 replaced `delegationSlices(readDelegation(delegation), cards)` with `delegationSlices(delegation, cards)`
in `fleetTree.ts`, and six suites (304 tests) stayed green, because every row that fed future words tested the helper
alone. Two rows now feed the frame as the socket parses it. The members are objects with words this build has never heard
of and a field it does not know. Nothing mocks the reader, and nothing normalizes the input first.

- **W4-U7b** (`fleetTree.test.ts`) calls the real `fleetTree`. Every member is kept once (2 activities, 2 worktrees,
  1 unowned item). An unknown group is re-filed `offline-coordinator` and an unknown placement `row`. An unknown liveness or
  workspace reads `unmeasured`. Only the two members the server measured live read live. The group headers count 2 and 1. The
  raw worktree keeps its `inferred` chip, and a creator chip naming the Bash call; the agent worktree wears neither.
- **W4-U7c** (`fleet-screen.test.tsx`) sends the same frame through the socket, the store, `FleetCards` and the card. It
  opens the coordinator's summary line (its two children fold into `1 delegated · 1 worktree`, D-6088's W/D rule, as W4-U31
  pins), then the two groups, and reads each row as the cells it draws. A future liveness or workspace word draws
  `unmeasured` and never `running` or `unrecognised`.

O4 was first measured alone in the earlier non-root scratch tree with these two files copied in, one suite per run
(historical observations, not compliant containment evidence):

- W4-U7b went red: the `a-group` member read group `future-group` where `offline-coordinator` was expected.
- W4-U7c went red: the `reword` row's liveness cell read `unrecognised` where `unmeasured` was expected.
- These suites stayed green: `delegation-words` (6), `nestFleet` (32), `project-card` (106), `fleet-rollup-render` (17) and
  `older-server-render` (1). None of them hands the tree a frame with future words.

Restored, `fleetTree.ts`'s sha256 matched the tracked file, and `fleetTree.test.ts` (34) and `fleet-screen.test.tsx` (110)
were green. In the corrected root-contained round, both suites passed before O4; the exact reader bypass then red U7b
(`future-group` instead of `offline-coordinator`, 1 failed and 33 passed) and U7c (`unrecognised` instead of `unmeasured`,
1 failed and 109 passed), run separately. Each was restored from the saved file, with sha256
`3e2675a99ff8a45748de33be30f28e2f081aa7a8878418abb54dff9ca3d94e21` matching, and its full suite passed again (34 and 110).
The member vocabulary, the wire, the workdir rule, the missing-parent rules and every other policy are unchanged.

### Residuals recorded, not fixed

- **Sort keys a member must carry.** `readDelegation` checks the envelope and that each member is an object. It does not
  check the strings a member must carry. Historically measured in a scratch-only file on the earlier non-root tree:
  - an activity missing `openedAt` throws a `TypeError` out of `fleetTree` when it is the second of two activities, because
    the sort reads it as the comparator's receiver;
  - the same activity draws when it is first, or alone;
  - a lease missing `firstObservedAt` throws the same way.

  This is the robustness of a malformed wire, not a supported mixed-version case: those fields are mandatory, and no
  producer was shown to omit them. This round adds no member validation or drop policy.
- **An empty display name.** `activityLine` leaves an empty `displayName` out of the row, but `delegatedChip` keeps it, empty,
  in its title (`delegated work running: , map`, historically measured in that non-root tree). No producer was shown to
  emit one. It is latent and cosmetic, and nothing changes. Neither advisory diagnostic was repeated in the corrected round.

### Corrected final verification

All final calls ran serially under one lock with root-filesystem `TMPDIR`, foreground tool timeouts of 600000 ms,
`systemd-run --user --scope -p MemoryMax=4G`, `nice -n19` and `ionice -c3`. Each start recorded decimal load1 at or below
40, available memory at least 4000 MiB, resolved scratch paths and `df` proofs for `TMPDIR` and the single source tree;
root and workspace free space stayed above 10 GiB. No new install, bulk dependency copy, live delegation read, live `ccd`
call, service action or cleanup was used. Existing package dependencies were linked; archived source and scratch writes
remained on the root filesystem. The new sampler measured load1 and available memory every 0.5 seconds during each
command: across these corrected runs its sampled peak load1 was 18.12 and minimum available memory 11116 MiB. These are
samples, not a continuous peak guarantee and not an audit of the earlier review panel.

| Final gate | Result | Wall seconds |
|---|---|---|
| PWA stores | 144 passed | 3.66 |
| delegation-words | 6 passed | 3.06 |
| nestFleet | 32 passed | 2.94 |
| fleetTree | 34 passed | 3.02 |
| rollup | 29 passed | 3.09 |
| project-card | 106 passed | 5.56 |
| fleet-rollup-render | 17 passed | 5.89 |
| fleet-screen | 110 passed | 18.46 |
| older-server-render | 1 passed | 4.56 |
| card-header-facts | 84 passed | 6.17 |
| fleet-css | 93 passed | 4.06 |
| contrast | 295 passed | 112.23 |
| css-vars | 3 passed | 2.93 |
| Full PWA | 316 files, 10289 passed, 1 skipped, no type errors | 407.13 |
| PWA tsc --noEmit | exit 0 | 24.50 |
| UI npm test (tsc --noEmit) | exit 0 | 6.69 |
| Contrast checker | all 7020 passed | 2.08 |
| Server citations | 4 passed | 4.87 |
| Server anchors | 9 passed | 6.04 |
| Server deviation-refs | 31 passed | 29.89 |
| Server rings | 10 files, 62 passed | 12.78 |
| Server single-definition | 12 files, 920 passed | 31.09 |
| Server typecheck-tests | 12 passed | 105.28 |

`origin/main` was freshly fetched at `73f77a085c111231861547ac16305a651e454060` for deviation-refs; it was not merged.
These current results replace the earlier non-root runs as execution evidence, not as history: the first full PWA run
of the original implementation was red on censuses, so the wave signal remains `suite: red` / `failure: shallow`.
The advisory and extra-mutant observations above remain explicitly historical. All 70 original JSON fingerprints
remain unchanged, independently checked against the characterization commit. The final server gates are pre-integration.

### What this round does not show

- The panel's containment was not audited in full.
- The cause of the `ccd-ws-orphan-verb` failure CI saw once at `8fdfb1d52` is unmeasured: it passed on a re-run, and it passed
  alone locally.
- The three post-PR1-merge reruns (`fleet-health`, `delegation-wave3.integration`, `typecheck-tests`) are still owed after
  `main` absorbs PR1.
- The full merge-queue run is still owed at landing.
