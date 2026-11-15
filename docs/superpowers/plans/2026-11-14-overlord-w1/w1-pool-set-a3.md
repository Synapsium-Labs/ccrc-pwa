# The Overlord W1 pool set, PR A3 (Tasks 4 and 5): measurements and departures

This note belongs to `w1-pool-set.md` and sits beside `w1-pool-set-departures.md` (PR A1's) and `w1-pool-set-a2.md`
(PR A2's), which a feature pull request may not edit. The coordinator folds it into the ledger. A departure is named by
a slug; no D-number is invented.

## Characterization (Task 4 Step 1), green on `main` before any reader moved

`server/test/ccd-pool-a3-characterization.test.ts`, committed alone, 96 pins, green against `main`'s `ccd/ccd`. For a
session with no set it drives eleven users (the swap target, the home re-seed and the affinity verb on a quiet tick, the
pay-per-use admission, `_strand_why`, `_strand_mark`, the hard-blocked tick's strand, the new-row and existing-row
start, `ccd swap`, `ccd prefer`, and the `cross-pool` swap.log line with its marker) in ten states: the project's four
(`untagged`, `named pool-a`, `unreadable`, `malformed`), the three undecidable account states of a tagged project
(`unreadable`, `stale`, `malformed`), the row's project field absent, that field unreadable on a box with no
`$POOLS_DIR`, and an unsearchable `$REG`. Each answer is pinned verbatim, the fixture HOME written as `$HOME` and the
clock as `<ts>`.

## What PR A3 adds

- **Task 4.** `_swap_target`, `_auto_swap_check`, `cmd_start`, `cmd_swap`, `cmd_prefer`, `_default_pool`, `_strand_why` and
  `_strand_mark` read `_session_pool_side` in place of `_project_pool_state`, each a 1:1 swap. A set on the route
  record now decides placement for its session: this is the first PR in which a standing set changes anything.
  - An existing row outside its set warns on start (`_pool_set_start_warn`), and so does one whose set cannot be
    decided, naming the set file; a project-side rc 2 on an existing row stays silent. A new row outside its set is
    refused. The tick relocates an existing row at its next idle boundary (slug `existing-row-warns-the-tick-relocates`).
  - The home re-seed stands down for a `set ` side (no `_ws_least_loaded`, no `home` write, no `rehome` line).
  - `_default_pool` asks `_pool_ok`: a pay-per-use lane joins only on rc 0 with the account side `named`.
  - Log lines, the strand banner and `_strand_mark`'s `[pool=…]` print `_pool_side_token`: `set:pool-b` for a set, the
    bare pool name for a named side, exactly as before.
  - The rc-2 sentence takes the session id when the side is a set (`_pool_set_sid`), so `cmd_start`, `cmd_swap` and
    `cmd_prefer` name `$REG/<id>.poolset`, or say the set decided on the account side (A2 review F1).
- **Task 5.** The crossing marker's pool field is the side token (`set:<spelling>`); `_crosspool_valid` and the tick
  match it with `_pool_cross_match`, and a lapsed set marker ends with "account set is now <spelling>". The tick's gate
  is `"named "*`, `"set "*` or `untagged`, so `set-unreadable` and `set-malformed` never delete a marker.
  `_swap_target` answers rc 4, 7 or 8 by side (`_pool_undecided_rc`), the tick's verdict site and the rescue map pick
  `pool`, `projection` or `set` (`_pool_undecided_word`), and `_undecidable_cause` gains the `projection` and `set`
  sentences (`_pool_undecidable_cause`).
- **The one behaviour change for sessions without a set** (slug `projection-word-fleet-wide`, its own commit): an
  undecidable account side now answers rc 7, stamps `projection`, and strands with a sentence naming
  `$REG/pool-epoch` and the pool sync, where it named the project's tag file. The characterization's nine account-state
  rows were rewritten in that commit and in no other.

### The readers of `_swap_target`'s rc (Task 5 Step 1), re-measured on the branch

| Reader | Rc 7 and 8 |
|---|---|
| `_rescue_target`, its three direct calls | undecided by rule now: `(( rc >= 2 && rc != 6 ))` returns them at once, with a non-empty `out` |
| `_rescue_strand_cause`, one direct call | reads stdout only; no change needed |
| `_rescue_target`'s five callers | `_auto_swap_check` twice: the rescue (`strc -ge 2`, then the map) and the class-gate retry (taken on `strc -eq 5` only); `_wake_ceiling_move` once (acts on rc 0 or 6 only); `_watchdog_one` twice, the second its class-gate retry (`trc >= 2` logs `watchdog-undecidable rc<n>`) |
| `_auto_swap_check`'s rescue map | `4\|7\|8) uword=$(_pool_undecided_word "$strc")`; the `*) uword="rc$strc"` arm stays, now pinned with rc 9 |

### Tests and measurements

| Suite | Result |
|---|---|
| `ccd-pool-a3-characterization` (new) | 96 passed: green on `main`, after Task 4 unchanged, after the projection commit with nine rows rewritten |
| `ccd-pool-a3` (new) | 30 passed; 24 failed against `main`'s `ccd/ccd`, and the last three (the projection ones) until that commit |
| `ccd-crosspool` | 125 passed (the unknown-rc stub moved from 7 to 9; the known-words case gained `projection` and `set`) |
| `ccd-auto-swap-pool`, `ccd-auto-swap-hold`, `ccd-default-pool`, `ccd-pool-ok`, `ccd-pool-sync` | 52, 5, 14, 87, 41 |
| `ccd-rescue-policy`, `-unknown-rank`, `-classwindow-drop`, `-jitter-solo` | 112, 14, 4, 19 |
| `ccd-swap`, `-carry`, `-carry-merge`, `-guards`, `-pin`, `-refuse`, `-target-class` | 19, 19, 43, 55, 33, 18 (1 skipped), 27 |
| `ccd-session-pool-side`, `ccd-acct-pool-state`, `ccd-project-pool` | 46, 46, 65 |
| `pool-set-spelling`, `pool-rule-core`, `ccd-split-pin`, `ccd-lib-load`, `ccd-contexts` | 72, 98, 17, 69, 15 |
| `growth-check` armed, `deviation-refs` (after `git fetch origin main`) | 95, 31 |
| `anchors`, `citations`, `ccd-line-citations`, `topology-clean` | 9, 4, 2, 61 |
| `ccd-reg-get-census` | 3 (red on the PR's first fast run: `_default_pool`'s own project read went into `_session_pool_side`, so the `_reg_get` header now says 208 calls on 176 lines and names that move) |
| server tsc | clean |
| tests tsc | the whole project was killed by the test slice's 6 GB cap three times; the three changed test files, checked under the same options, are clean. CI decides |
| `shellcheck-ratchet` | killed by the same cap (as in A2). The library alone and the twelve changed `ccd/ccd` functions alone give the same findings as on `main`. CI decides |

The `_pool_ok ` line count over `ccdSource()` is now 17, 13 of them call sites (`_default_pool`'s new call); the
header in `ccd/ccd` says so, and says that `_default_pool` clobbers the globals only inside `$( )`.

### Growth, against `origin/main` (non-blank, non-comment lines)

| File | Net |
|---|---|
| `ccd/ccd` | +3 |
| `ccd/lib/pool-set.sh` | +30 |
| `ccd (program)` | +33 |

All under 40, no waiver, so Task 5 stays in this PR.

### Mutations, each restored from a saved copy and compared byte for byte

| Mutation | `ccd-pool-a3` |
|---|---|
| The tick reads the project side (plan Step 6) | 4 failed |
| The existing-row set warning silent (plan Step 6) | 2 failed |
| `stuck=pool` whatever the side (plan Step 6) | 3 failed |
| The tick's gate a bare `set*` (plan Step 6) | 1 failed (the kept-marker row) |
| The re-seed runs for a set side | 1 failed |
| `_rescue_target`'s test back to `rc <= 5` | 1 failed |
| `cmd_swap` and `cmd_prefer` without `_reg_id_ok` | 1 failed |
| `_strand_why` without its set arm | 1 failed |
| `_default_pool` reads the project | 1 failed |
| `_swap_target` reads the project | 7 failed |
| `_pool_cross_match` by name only | 3 failed |
| The projection's rc folded into 4 | 1 failed |
| The projection sentence without the set's tail | 1 failed |
| `_pool_side_token` prints the word for a set | 3 failed |
| `_strand_mark` names a named side only | 1 failed |

## Departures

- **`a3-notes-in-a-new-file`.** This PR's measurements are here, not in the A1 or A2 notes.
- **`characterization-in-one-suite`.** Step 1's pins are one new matrix suite rather than additions to each user's suite,
  so "unchanged after" is one file's diff: the projection commit's nine rows.
- **`task4-and-marker-kind-one-commit`.** Task 4 and Task 5's marker kind and set word share one commit
  (`feat(ccd): every pool user keyed by a session reads its side, and the crossing marker carries its kind`): a set
  side's swap writes a marker, so Task 4's cases need the `set:` field. The `projection` fix is its own commit, as the
  plan asks.
- **`cross-field-is-the-side-token`.** The plan's `_pool_cross_field` and `_pool_side_token` print the same thing, so
  there is one function, `_pool_side_token`.
- **`undecided-rc-and-word-are-two-helpers`.** The plan's `_pool_side_rc_word` is two helpers: `_pool_undecided_rc`
  (side to rc, used in `_swap_target`, where the side is in scope) and `_pool_undecided_word` (rc or side to word, used
  at the verdict site and in the rescue map).
- **`set-cause-sentence-in-the-library`.** `_undecidable_cause` gains one arm, `projection|set`, which calls
  `_pool_undecidable_cause` in the library.
- **`projection-sentence-names-the-set-for-a-set-session`.** The tick and rescue paths' `projection` sentence ends "the
  session pool set decided, and the project tag is not involved" for a set session, as the start, swap and prefer
  sentences do (A2 review F1, Review Focus 4). For any other session it ends "not the project tag".
- **`existing-row-undecidable-warns-for-a-set-only`.** The existing-row warning on rc 2 is given when the session's side
  is a set (the set itself undecidable, or the account side under a set). A session without a set stays silent on rc 2,
  as on `main` (characterization).
- **`swap-prefer-validate-the-id`.** `cmd_swap` and `cmd_prefer` refuse an id `_reg_id_ok` refuses, with their existing
  "no registry for" message, so `_session_pool_side` gets validated ids only (A2 review F5). `cmd_start` already
  validated both its forms; every other caller passes a registry row's id.
- **`strand-names-an-untagged-account-a-set-refuses`.** `_strand_why` lists an untagged account that a set without
  `+untagged` refuses as `<account>:pool=untagged`; on `main` an untagged account always served, so it never appeared.
- **`strand-mark-names-a-bad-set`.** `_strand_mark` names a set side by its token, and an undecidable set by its word
  (`set-unreadable`), never as `(untagged)`, which is what an undecidable project tag still prints, as on `main`.
- **`contexts-edges-under-a-peer-grant`.** `ccd/contexts-edges.tsv` gains `cmd_start`'s five new edges and loses
  `cmd_start -> _project_pool_state`, under the run 2117 builder's grant; `ccd/ccd`'s hunks are under the same grant.
