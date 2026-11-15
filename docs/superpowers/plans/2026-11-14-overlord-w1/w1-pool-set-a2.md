# The Overlord W1 pool set, PR A2 (Task 3): measurements and departures

This note belongs to `w1-pool-set.md` and sits beside `w1-pool-set-departures.md` (PR A1's), which a feature pull request
may not edit. The coordinator folds it into the ledger. A departure is named by a slug; no D-number is invented.

## Characterization (Step 1), green on `main` before any edit

| Suite | Tests passed |
|---|---|
| `server/test/ccd-pool-ok.test.ts` | 48 |
| `server/test/ccd-route-fields.test.ts` | 49 |

The `_pool_ok ` line count over `ccdSource()` was 16 (the figure `ccd/ccd`'s header states). Today's project and account
sentences of `_pool_undecidable_why` and `_pool_mismatch_why` are pinned by the new suite's characterization block, green
against the unchanged renderers before their set arms were added.

## What PR A2 adds

- `ccd/lib/pool-set.sh`: `_session_pool_side` (the one reader of a session's side), `_pool_ok_set` (`_pool_ok`'s set
  case, called bare), and the two set renderers `_pool_set_undecidable_why` and `_pool_set_mismatch_why`.
- `ccd/ccd`: `_pool_ok`'s one set arm, `_pool_undecidable_why`'s fifth argument (the session id) and its set arm,
  `_pool_mismatch_why`'s set arm, and `cmd_route`'s refusal of a `poolset` or `acctorder` write from a session's shell.
- Nothing calls `_session_pool_side` yet (Task 4 is PR A3), so placement is unchanged.
- `ccd/ccd`'s `cmd_route` refuses a `poolset` or `acctorder` write, a clear included, when `CLAUDECODE` is set
  (`pool-set-operator-only: a Claude Code session may not write <field>`), beside `_route_fable_shell`'s refusal. This
  is the coordinator's ruling on A1's review question, slug `a-session-shell-cannot-write-its-own-set`.

## After the task

| Suite | Result |
|---|---|
| `ccd-session-pool-side.test.ts` (new) | 44 passed |
| `ccd-pool-ok.test.ts` | 87 passed (48, plus 24 set rows, 10 equivalence rows and 5 other new cases) |
| `ccd-route-fields.test.ts` | 56 passed (49 plus 7 for the session-shell refusal) |
| `pool-set-spelling`, `pool-rule-core` | 72 and 98 passed |
| `ccd-crosspool`, `ccd-pool-sync`, `ccd-project-pool`, `ccd-auto-swap-pool`, `ccd-default-pool` | 125, 41, 65, 52 and 14 passed |
| `ccd-route-argv`, `ccd-fable-default`, `ccd-split-pin`, `ccd-lib-load`, `ccd-contexts` | 34, 15, 17, 69 and 15 passed |
| `sim/mutation-floors`, `pools-prose`, `projected-home`, `topology-clean`, `box-token-census` | 75, 27, 63, 61 and 58 passed |
| `single-definition/roster-bash`, `writers-map`, `vocabularies`; `anchors`, `citations`, `ccd-line-citations` | green |
| `growth-check` (armed, `GROWTH_CHECK=1`) | 95 passed |
| `deviation-refs` (after `git fetch origin main`) | 31 passed, run alone. In a batch under load (about 11), one case passed its 20 s timeout. |
| server tsc, server tests tsc, pwa tsc | clean |
| `shellcheck-ratchet` | not measured here: the one-text program needs about 7 GB and the run was killed. CI decides. The library alone shows one new finding, SC2209 on `POOL_OK_SIDE=set`, and that line is now quoted. |

`platform-hazards.test.ts` R14(i) is red on this box: it probes this box's bash 5.3.9 and reads no file this PR touches.

The `_pool_ok ` count over `ccdSource()` is still 16. The new arm calls `_pool_ok_set`, and the library's comments write
`_pool_ok` before a backtick, never before a space. The header was left as it is.

### Growth, measured against `origin/main` (non-blank, non-comment lines)

| File | Net |
|---|---|
| `ccd/ccd` | +4 (5 added, 1 changed: `_pool_undecidable_why`'s signature comment) |
| `ccd/lib/pool-set.sh` | +34 |

Both are under 40 with no waiver, so the two renderers stay in A2.

### Mutations (Step 6), each restored from a saved copy and compared byte for byte

| Mutation | Result |
|---|---|
| An unreadable set (link, non-regular, mode) answers the project's word | red: `ccd-session-pool-side` 5 failed |
| The bytes read through `_reg_read_to` instead of the bounded read | red: `ccd-session-pool-side` 13 failed (the NUL, newline and cap rows among them) |
| `cmd_route` without the session-shell refusal | red: `ccd-route-fields` 5 failed |
| The refusal moved after the clear (a clear from a shell passes) | red: `ccd-route-fields` 2 failed |
| `_pool_ok` without its set arm | red: `ccd-pool-ok` 37 failed |
| An unknown set word (`set-*`, bare `set`) left to the project arm | red: `ccd-pool-ok` 1 failed |
| An untagged account serves any set | red: `ccd-pool-ok` 1 failed |
| Membership by substring instead of whole names | red: `ccd-pool-ok` 4 failed |
| A bad set read after the account side is asked | red: `ccd-pool-ok` 1 failed |
| `_session_pool_side` without `local LC_ALL=C IFS=' '` | red: `ccd-session-pool-side` 1 failed |
| A passed empty project read as "no project" | red: `ccd-session-pool-side` 1 failed |
| `_pool_undecidable_why` without its set arm | red: `ccd-session-pool-side` 1 failed |

## Departures

- **`a2-notes-in-a-new-file`.** This PR's measurements are recorded here, not in `w1-pool-set-departures.md`. A feature
  pull request may not edit an existing file under `docs/superpowers/plans/` (the `ledger-guard` step).
- **`unknown-set-word-names-the-set-side`.** The coordinator's ruling (A1 review N5): `_pool_ok` routes `set`, any
  `set …` and any `set-*` word to `_pool_ok_set`. A word that is not `set-unreadable`, `set-malformed` or a `set …`
  spelling answers rc 2 on the set side with the state `unrecognised`. `_pool_undecidable_why`'s set arm then names
  `$REG/<id>.poolset`, never the project's tag file. A word that only begins with `set` (`settled`) stays on the project
  side, as today.
- **`empty-set-has-no-bash-word`.** The empty set has no spelling (open question 3), so `_session_pool_side` never
  prints a word for it. `ccd-pool-ok.test.ts` skips the three empty-set rows of `POOL_RULE_CASES`; the skip is bounded,
  and its rows are exactly the empty sets. The word a caller could still build, `set ` with nothing after it, is pinned
  to fail closed: rc 2, side `set`, state `malformed`. `poolRule` answers a mismatch for those rows, and either way
  nothing is served.
- **`set-unparsable-word-fails-closed`.** `_pool_ok_set` parses the spelling again rather than trusting its caller. A
  `set …` word that does not parse answers rc 2 on the set side before the account side is asked.
- **`reader-has-no-second-cr-check`.** Plan Step 4 lists "holds a CR or a newline" as a separate reader test.
  `_poolset_parse`'s charset test already refuses both before it splits anything, so the reader adds no second check.
  The CR, CRLF and trailing-newline rows pin it.
- **`shell-refusal-covers-the-clear`.** The session-shell refusal also covers an empty value. Clearing a set drops the
  session to its project, which for the Overlord serves every account, so a clear is as much a write as any other.
  The refusal sits before the empty-value `continue`, so a refused field refuses the whole call.
- **`undecidable-why-fifth-argument-optional`.** `_pool_undecidable_why`'s session id is read as `${5-}`, so today's
  four-argument callers are unchanged. The set side's callers arrive in PR A3, and each passes the id.
- **`pools-prose-cap-27`.** The account-pools bullet in `CLAUDE.md` gained two lines for the plan's sentence on
  `_session_pool_side`. `pools-prose.test.ts`'s ceiling goes from 25 to 27, re-measured, with its reason beside the
  two earlier raises.
- **`tests-written-with-the-code`.** The library was written first. The red evidence is the three set-sentence cases,
  red against the unchanged `ccd/ccd` before its arms went in, and the twelve mutations above.
