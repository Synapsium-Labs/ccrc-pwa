# Overlord W1 ccd arms, PR C1: notes for the ledger

PR C1 builds Task 6 of [`w1-ccd-arms.md`](../w1-ccd-arms.md): the fresh pick's decider, steps 1 and 2 and its refusals,
in `ccd/lib/long-lived.sh`'s region `freshpick`. These notes are what the programme ledger should learn from it. Each
departure carries a plain-words slug (cross-plan ruling X9); none has a D-number.

## In short

- `FRESH_PICK_SOFT_PCT=70`, `FRESH_PICK_FALLBACK_CLASS=opus`, `_fresh_pick_ok` and `_fresh_pick_to` are built as the plan
  rules, with one small reader beside them (`_fresh_pick_field_to`).
- Nothing calls the decider but `server/test/ccd-fresh-pick.test.ts`, so no session's behaviour changes. Account
  switching and the auto-swap are untouched. PR C2 adds step 3, `stay`, the settle and the wiring into the fresh start.
- The decider writes nothing, except `_authdead`'s D-3524 expiry of a stale marker (review 2336 F1, ruled: accepted):
  no other registry field, no stamp, no route row, no log line. The hold-down is read through `_route_holddown_holds`,
  which writes nothing either, and a test pins the stamp's mtime unchanged.

## 1. Growth, measured

Measured with `growthCheck.ts`'s own counting (`codeLines`), against the merge base `d60759599`.

| File | Net code lines | Plan's estimate |
|---|---|---|
| `ccd/lib/long-lived.sh` | +33 | +25 to +30 |
| `ccd/ccd` | +0 (one comment line edited) | +0 |
| `ccd (program)` | +33 | +25 to +30 |

*Table 1. Every row is at 40 or under, with no waiver.*

## 2. Departures, by slug

| Slug | What and why |
|---|---|
| `fresh-pick-library-is-33-lines` | The region is 33 code lines, above the estimate of 25 to 30 but inside the 40-line rows: the bounded reader (`fresh-pick-field-read-is-bounded`) and the class refusal (`fresh-pick-refuses-an-unreadable-class`) each cost lines the estimate did not count. |
| `fresh-pick-field-read-is-bounded` | The two fields the decider reads itself, the list and the class, go through a new helper, `_fresh_pick_field_to`, bounded in size and in time (`_plat_timeout 2 head -c`), as `_role_long_lived` reads `profile`, because the brief rules bounded reads and never `_route_get`, and `_reg_read` is not bounded in time. A `$REG` that is not a searchable directory, a link, a non-regular file, an unreadable one or a timed-out read answers rc 2. The bound covers those two fields only: the helpers the decider calls keep their own reads, and two of them are not bounded in time on `main` (`_share_pct`'s sweep file and `_session_pool_side`'s set read; review 2336 F4, carried into C2's notes). The list is read at `ROUTE_LIST_MAX_BYTES + 1` bytes, so a 1,025-byte list fails `_acctorder_valid` (pinned with a list of valid ids, so only its size refuses it). |
| `fresh-pick-refuses-an-unreadable-class` | The plan says only "cls = the route's class (default reads none)". A `class` entry that cannot be read, or holds a word `_route_valid class` refuses, is a refusal with its own sentence (`the class on <path> cannot be read; the designation writes it again`), not "no class": undecidable is a refusal, never a pick (Review Focus 2). An absent entry is no class. |
| `fresh-pick-one-pass` | Steps 1 and 2 run in one pass over the list: each account's hard filter and load once, then the class gate on the class (step 1, which returns at once) and on the fallback (step 2, the first kept). The answer is the plan's: step 1's first account wins over any step 2 account, earlier or later. |
| `fresh-pick-clause-words` | The refusal sentence's clauses are `<account> <word>`, with the plan's eight words, joined by `; ` in list order. An account that passes the hard filter and the load but neither class gate (or whose step 1 is held and which has no fallback) is `class`. |
| `fresh-pick-no-class-gate-asks-with-the-id` | For a route with no class or `default`, the plan says the class gates are skipped. `_fresh_pick_to` still asks `_class_gate <account> "" <id>`, `main`'s signature since serviceability A, which answers servable except for a set side whose account has no continuity record (serviceability A's F8). So the no-class path is "step 1 on load alone" on a project side, and keeps serviceability A's continuity rule on a set side. No hold and no step 2, as the plan says. |
| `fresh-pick-hold-needs-a-stamp` | The hold is asked only when a `degraded` entry stands (`-e` or `-L`): `_route_holddown_holds` reads an absent stamp's time as unmeasured and holds, which would skip step 1 for every long-lived row with no stamp at all. |
| `fresh-pick-pool-ok-count` | The `_pool_ok` header in `ccd/ccd` measures `cat ccd/ccd ccd/lib/*.sh \| grep -c '_pool_ok '`; the decider's call makes it 19 lines and 15 call sites (comment only, `ccd-pool-ok.test.ts` pins it). |
| `fresh-pick-out-var-forms-registered` | `_fresh_pick_to` and `_fresh_pick_field_to` are out-var forms, so `server/test/ccdTickDietRunner.ts`'s `PLANNED_FORMS` and `LANDED` name them (`ccd-tick-diet-equivalence-static` E1c). |
| `fresh-pick-answer-vars-lint-note` | `FRESH_PICK_STEP` and `FRESH_PICK_WHY` are set and read by no caller until PR C2, so a reasoned `# shellcheck disable=SC2034` directive sits above `_fresh_pick_to`, as `ccd/lib/delegation-lease.sh` does for its answer variables. |
| `fresh-pick-authdead-expiry-is-the-one-write` | The decider is not write-free: `_fresh_pick_ok` asks `_authdead`, which removes an auth-dead marker whose lane's credential changed at or after the marker's epoch (D-3524), as it does for every placement reader. The coordinator ruled to accept it (review 2336 F1, option a): `_authdead` is that marker's one owner, and a read-only second reader would break the consolidate rule for no gain. The headers, these notes and the test title say "writes nothing, except `_authdead`'s D-3524 expiry of a stale marker", and a case pins that removal as the only change. C2's "a refusal touches nothing" test allows the same one exception. |
| `fresh-pick-registry-must-be-searchable` | `_fresh_pick_field_to` first checks `[[ -d "$REG" && -x "$REG" ]]`, as `_reg_read_to` does, so a registry it cannot search answers rc 2 and the decider refuses with the list sentence, never "no list" and the current account (review 2336 F2). |
| `fresh-pick-helper-pins-measured` | Review 2336 F6. The decider's `LC_ALL=C` is pinned: under `en_US.UTF-8`, bash's `[0-9]` matches an Arabic-Indic digit, so a load figure in such digits would reach the arithmetic and print an error; the case asserts the answer `load` and an empty stderr, and reds when `LC_ALL=C` is dropped from both functions. The helper's own `LC_ALL=C` cannot be pinned: dropped from the helper alone, every case stays green, because its only locale-reading steps are `head -c` and `tr`, which work in bytes in any locale. Of the helper's type tests, `-L` is pinned by the link-to-a-good-list case and `! -f` by a timing case (a FIFO list refuses in under a second, where the read bound takes 2 s). `! -r` cannot be told apart from the read failing: `ccd` runs under `pipefail`, so a mode-000 entry already answers rc 2 through the failed `head`; the mutant that drops it stays green. |
| `no-class-gate-suite` | The brief names `ccd-class-gate*` suites; none exists on `main`. `ccd-serviceable` and `ccd-swap-target-class` cover `_class_gate` and ran green. |

*Table 2. Departures from the plan's text, each the builder's own call within the rulings.*

## 3. Verification

- New suite `ccd-fresh-pick.test.ts`, 43 cases since fix round 1 (39 at the first review): every case of Task 6's Step 1, plus the 70% boundary, the seven-day
  window, the `_class_gate` signature, the hold's edges (no stamp, a plain profile, an opus row), each refusal shape
  (FIFO, links, directory, repeat, empty, 1,025 bytes, a NUL, mode 000, set-unreadable, set-malformed, an unreadable
  class) and the registry left byte- and time-identical.
- Mutation, one mutant at a time in place, restored from a saved copy: the plan's six mutants and eleven more (dropping
  each hard-filter check, the stamp-existence test, a hold on rc 3, the read cap at 1,024, the set refusal, the link
  test, the first-kept step 2, the session id on the gate, and folding an unreadable class into none). All 17 turn a
  case red. Fix round 1 (review 2336) added eight more, one at a time the same way. The unconditional removal of a
  marker, the expiry of every listed account's marker outside `_authdead`, the dropped `$REG` check, `LC_ALL=C` dropped
  from both functions, the dropped `! -f` and the dropped `-L` each turn a case red. `LC_ALL=C` dropped from the helper
  alone and the dropped `! -r` stay green, for the reasons under `fresh-pick-helper-pins-measured`.
- Green: `ccd-route*` (9 files), `ccd-pool*` (5), `ccd-serviceable`, `ccd-swap-target-class`, `ccd-tick-budget`,
  `ccd-keep-awake`, `ccd-long-lived`, `ccd-lib-load`, `ccd-split-pin`, `ccd-contexts`, `growth-check` armed,
  `ccd-tick-diet*` (12), `ccd-bounded-reads`, `single-definition/*`, `rings/*`, `anchors`, `citations`,
  `deviation-refs` (after `git fetch origin main`), and the server typecheck.
- `ccd/contexts.tsv` gains three C1 rows; `ccd/contexts-edges.tsv` is unchanged, as every call the decider makes stays in
  C1 or K.
- Organization C (#2955) holds `ccd/ccd` and `ccd/contexts.tsv` and agreed to this PR co-editing both (the `_pool_ok`
  count line and the three rows); its hunks and these are apart, so whichever lands second merges `main` once.
- Locally unmeasured, left to CI: the shellcheck ratchet and the tests typecheck are each killed by the local test
  slice's 6 GB memory cap, as PR A's and PR B's were. `shellcheck -S warning` reports nothing on `ccd/lib/long-lived.sh`.
- The first full CI run's shellcheck ratchet found one SC2100 the lone-file lint cannot see: over the spliced program text,
  `FRESH_PICK_FAIL=at-ceiling` reads as a subtraction. The word is quoted now (`'at-ceiling'`), and the program pin stays at 82.
