# C1 — the crossing tick measures its own inputs

**Base:** `origin/main` `4dc87366` (wave 2b, #62), merged forward to `d0064e6e` (#66).
**Branch:** `ws/clear-meadow`.
**Scope:** `ccd/ccd` + `server/test/ccd-crosspool.test.ts`. **Deploy: AGENT-FIRST.**

This is not a wave. It is the one carry wave 2b filed under `## Wave-3 carries` that ships under an
**embargo**, landed on its own before account-pools wave 3 opens, by coordinator ruling (run 35,
mail 308, ruling 2). Wave 3's Global Constraint is "this wave touches no file under `ccd/`", and
wave 3 ships the server routes that DRIVE `--cross-pool`; landing the fix separately is what keeps
both sentences true at once.

## The defect

`_reg_get` is `cat "$REG/$1.$2" 2>/dev/null` (`grep -n '^_reg_get()' ccd/ccd`). It folds **absent**,
**unreadable** and **empty** into one `""`. `_crosspool_tick` — the crossing marker's only judging
expirer, run on the 5-second supervise tick for every session on the box — acted on that fold: it
deleted a marker whose record it merely could not **read**, and it logged `moved off <acct>` for a
current account it had never measured.

Both are the error the function already refuses to make about the PROJECT TAG, in its own words:
**undecidable is not a decision.** A transient permission hiccup on `$REG` could end every live
crossing on the box inside one tick, irreversibly, with no writer able to put the marker back.

The carry named the fix pattern and forbade the shortcut: "what this needs is a read that
DISTINGUISHES absent from unreadable (`server/src/io.ts`'s measured reads are the pattern), not
another predicate over the same collapsed value."

## Where the read had to go, which is not where the carry pointed

The carry says "at that call site", and a first pass put three guards inside `_crosspool_tick`.
Review measured that this does not achieve its own purpose, in two independent ways — both
reproduced end-to-end in a fixture HOME, neither refuted:

- **`_crosspool_valid` is the one reader of the marker's bytes, and it has three consumers.**
  `_swap_target` asks it the same question on the same tick. With only the expirer guarded, an
  unreadable record still gave `cross_cur=""`, therefore `force=pool` (the must-leave), therefore a
  relocation off the crossed account — while the expirer was correctly leaving the marker standing.
  Preserving the marker and undoing the crossing anyway is not half a fix (D-1991).
- **A guard that re-measures the file still acts on the caller's value.** `cur`/`home` are read at
  the top of `_auto_swap_check` through `_reg_get`/`_home_for`; a guard's own later `_reg_read`
  certifies "readable now", not "the value I am about to act on was measured". Two reads, two
  moments. A zero-byte-but-readable `.wrapper` is read SUCCESSFULLY, so an rc-only guard passes it
  and the empty value reaches the arms that treat `""` as an account (D-1993).

So the distinguishing read is spent at the two points where every consumer is still downstream:
`_crosspool_valid` (the marker record) and the top of `_auto_swap_check` (`.wrapper`/`.home`).

## What landed

**`_reg_read id field` → rc 0 read / 1 absent / 2 unreadable**, beside `_reg_get`, which is
untouched. The three-way answer rides an **exit code**, the vocabulary this file already uses for a
three-way answer — `_pool_ok`'s rc 2 is "nobody decides", and this rc 2 says the same about a field.
Its two levels are asked in the order `_project_pool_state` asks them: the registry directory first
(`-d && -x`, copied from `ccd/ccd:1141`), then the field (`-e || -L`, the pairing at `:1151-1152`).

**`_home_measured`**, `_home_for` with the fold removed. It agrees with `_home_for` on every DECIDED
input — absent and empty both take the `_id_wrapper` fallback, because a row that never had a
`.home` is old, not unmeasurable — and differs only by refusing to answer on rc 2.

**`_crosspool_valid` answers 0 / 1 / 2**, so all three consumers inherit the third answer:
`_crosspool_tick` returns 2 and leaves the marker standing; `_swap_target` answers nothing and lets
the next tick try again (the remedy its own undecidable-TAG paragraph already prescribes);
`cmd_swap` refuses, because an operator asking to leave the pool right now may not be let through by
a crossing nobody can read.

**`_auto_swap_check` measures its own inputs once, before every decision it makes.** A tick that
cannot measure the row's current account decides nothing at all — no swap, no re-seed, no strand, no
expiry — and the next tick, five seconds later, tries again (D-1992).

**Standing still is said out loud.** Every `return 2` path used to write nothing, which trades a
rare destructive act for a silent permanent wedge — nothing in ccd ever re-chmods a registry file.
`_tick_undecidable` writes ONE `tick-undecidable` line per episode to `$REG/swap.log`, first-write-
wins on a `tickstuck` stamp that `_tick_decided` clears the moment the row decides again (D-1995).

**The reason string stopped lying.** `marker record is unreadable` covered three conditions; it now
covers none of them, and the honest ones are `empty`, `malformed`, and — for the condition that is
no longer a reason at all — the marker left standing with one line naming the field.

## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-08.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `project: ccrc-pwa`, `runId: 35` and `byId`
filled from this pane (`ccrc-pwa-clear-meadow`), in three calls as the work found them: **D-1986–
D-1990** (floor to 1991), then **D-1991–D-1999** for the review round (floor to 2000), then
**D-2000–D-2001** (floor to 2002). Every number below is DEFINED here and nowhere else.

- **D-1986 (2026-09-08)** — `_home_for` substitutes the id-derived wrapper for an unreadable
  `.home`; the shipped comment said both arguments arrive as `""`, and for `home` that was never
  true. `_home_for` is `h=$(_reg_get "$1" home); [[ -n "$h" ]] && echo "$h" || _id_wrapper "$1"`, so
  a failed read presents as a REAL ACCOUNT NAME that no read produced — worse than `""` in both
  directions: it cannot match the marker when it should, and it CAN match when it should not.
  `_home_measured` is the answer to both, because it sits ABOVE `_crosspool_valid` rather than
  after it. Pinned by `` `_home_for` answers a DIFFERENT account for an unreadable `.home` ``.
- **D-1987 (2026-09-08)** — the marker record had a THIRD condition wearing `unreadable`'s name:
  bytes read whole that carry no pool token (`read -r ts pool acct <<<"1788888888"` leaves `pool`
  empty exactly as an empty record does). The carry named absent/unreadable/empty; malformed is a
  fourth, and it is *decided*, so it ends the crossing — with its own reason, because a zero-byte
  write and bytes that do not parse send an operator to different places.
- **D-1988 (2026-09-08)** — declining to delete the marker was NOT enough on its own. The caller's
  `&& crossed=1` read the new rc 2 as "no crossing stands", and the home re-seed is gated on that
  same emptiness — so the tick would decline to delete the marker and then clobber `.home` off the
  very state it had just refused to act on.
- **D-1989 (2026-09-08)** — `_reg_read` needs a REGISTRY-level arm as well as a field-level one:
  `[[ -e ]]` is false when `$REG` itself cannot be entered, so a bare existence test reports every
  field on every row **absent** — the fold in its most convincing disguise, and fleet-wide rather
  than per-row. Corrected in the same round by D-1996.
- **D-1990 (2026-09-08)** — DISCLOSED, NOT CLOSED, and re-stated at review because the first
  version of this entry was measurably wrong. It said the residual was "the same two fields" and
  that every remaining read of them "refuses or ranks, it does not delete a marker". Both halves
  were false: the marker RECORD was a third folded input, and `_swap_target`'s use of it produced a
  RELOCATION, not a refusal. Those are now closed (D-1991). What actually remains folded, measured
  at the tip: **`.project`**. `project=$(_reg_get "$id" project)` feeds `_project_pool_state` at
  four sites (`_swap_target`, `_auto_swap_check`, `cmd_swap`, `cmd_prefer`), and that function
  answers `untagged` for an empty argument — deliberately, for the pre-2026-07-28 rows that have no
  `.project` at all. So an UNREADABLE `.project` reads as "this project is in no pool" and silently
  lifts the pool constraint for that row. It is the same defect class in a different field, it is
  larger than this carry, and it is reported to the coordinator rather than folded in here
  (D-2000). Also residual and much smaller: `cmd_prefer`'s `old=$(_home_for "$id")`, which labels a
  journal line rather than deciding anything.
- **D-1991 (2026-09-08)** — a guard on the EXPIRER ALONE does not close the carry, and the carry's
  own words ("at that call site") point at the wrong site. `_crosspool_valid` is the one reader of
  the marker's bytes and has three consumers; with only `_crosspool_tick` guarded, an unreadable
  record still gave `_swap_target` `cross_cur=""`, therefore `force=pool`, therefore a relocation
  off the crossed account — the marker preserved and the crossing undone anyway. Reproduced
  end-to-end in a fixture HOME before the fix. The read moved into `_crosspool_valid`, so all three
  consumers inherit the third answer.
- **D-1992 (2026-09-08)** — and the same argument reaches `cur`/`home`: guarding them inside
  `_crosspool_tick` left every OTHER consumer of the same two values (`_pool_ok`, `_swap_target`,
  the strand arm, the affinity verb) reading `_reg_get`'s fold. The measurement belongs at the top
  of `_auto_swap_check`, the one point where all of them are still downstream, and the remedy there
  is to decide nothing this tick rather than to guard each arm.
- **D-1993 (2026-09-08)** — an rc-only guard is not enough, because EMPTY is not UNREADABLE. A
  zero-byte field is READ SUCCESSFULLY: `_reg_read` answers rc 0, so a guard that asks only "did
  the read succeed" passes it and the empty value reaches the arms that treat `""` as an account —
  the same fabricated `moved off`, by a different route, with every read reporting success. Hence
  `-n "$wrapper"` beside `-eq 0`.
- **D-1994 (2026-09-08)** — the `-e` pre-gates were a fourth read of the marker path and kept the
  fold: `-e` follows symlinks, so a dangling symlink or a symlink loop answered "no crossing
  stands" for a path `_reg_read` calls unreadable. Under C1's caller that answer stopped being
  merely permissive — rc 1 is the one value that positively ENABLES the home re-seed, so the cheap
  gate could authorise the clobber the expensive one refuses.
- **D-1995 (2026-09-08)** — rc 2 was a SILENT, UNBOUNDED refusal. C1 turns a destructive answer
  into a standing-still, and that trade is sound only if the standing-still is observable: nothing
  in ccd ever re-chmods a registry file, so a permanently unmeasurable field parks the row for ever
  with no artifact anywhere. The code before C1 was wrong and LOUD; silence is the worse failure.
  `_tick_undecidable` gives it one `tick-undecidable` line per EPISODE, first-write-wins on a
  `tickstuck` stamp that clears the moment the row decides again.
- **D-1996 (2026-09-08)** — the registry-level arm must be the POSITIVE `-d && -x` pairing that
  `_project_pool_state` already uses at `ccd/ccd:1141`. The single `-d "$REG" && ! -x "$REG"`
  conjunct D-1989 shipped covered exactly one anomaly and left `$REG` missing, `$REG` a regular
  file, `$REG` a symlink loop and `$REG`'s own parent unsearchable all answering ABSENT for fields
  that may well exist.
- **D-1997 (2026-09-08)** — `chmod 000` cannot build unreadability for root, so every case using it
  is `skipIf`-ed there. Measured: with every `skipIf` predicate forced true, deleting any of the
  tick guards, the caller's re-seed gate or `_reg_read`'s registry arm left the suite GREEN — a
  root run reported success over the pre-C1 behaviour. A DIRECTORY in the field's place is refused
  by `cat` at every uid (EISDIR) and keeps `-e` true, so the read is genuinely reached; every
  mechanism guard now has at least one case that runs at every uid, and the root-simulated table
  matches the ordinary one row for row.
- **D-1998 (2026-09-08)** — `_reg_read` DIVERGES from the pattern it cites. `server/src/io.ts`'s
  measured reads are the model for the absent/unreadable split, and that much is copied; the
  dangling symlink is where the two part company, because `io.ts` rules it ABSENT on an
  errno-is-ENOENT argument and this rules it UNREADABLE on a may-a-destructive-arm-act-on-this
  argument. Citing a pattern without its exceptions is how a reader inherits a claim nobody made.
- **D-1999 (2026-09-08)** — the embargo does not lift on the merge sha. `_crosspool_tick` runs
  inside the ~20 long-lived `ccd supervise` processes, which hold the pre-deploy inode until they
  are restarted; the lift condition is a successful AGENT deploy including its supervisor sweep.
  A merge alone changes nothing on the fleet box.
- **D-2000 (2026-09-08)** — REPORTED, NOT TAKEN. The `.project` fold described under D-1990: an
  unreadable `.project` reads `untagged` and lifts the pool constraint for that row, at four sites.
  Same class, different field, wider than this carry; the coordinator sequences it.
- **D-2001 (2026-09-08)** — a number I measured myself, attributed to a source that never stated
  it. The first version of `_reg_read`'s header said the wave-2b carry "quoted" 113 call sites;
  `grep -c '113'` over that plan returns zero and the C1 carry cites no number at all. 113 is
  `grep -c '_reg_get "' ccd/ccd`, i.e. my own line-count. This is the misattribution class this
  program booked four deviations for last wave, committed while writing the fix for the previous
  one. The count now names the command that actually produces it and attributes nothing.

## Mutation table — measured 2026-09-08, one mutation at a time, suite re-run per row

| mutation | suite | reds |
|---|---|---|
| _crosspool_valid's rc-2 arm deleted | 5 failed | 52 passed | ``_crosspool_valid` itself answers rc 2 — the third answer every consumer inherits`; ``_swap_target` stands still on an unmeasurable marker — the ROOT-SAFE twin`; `a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree`; `a record that fails the FIRST read and succeeds on the second still decides nothing`; `an UNREADABLE record stops `_swap_target` too — the marker survives AND the session stays` |
| _crosspool_tick stops honouring rc 2 from the shared reader | 1 failed | 56 passed | `a record that fails the FIRST read and succeeds on the second still decides nothing` |
| the tick's guard becomes rc-ONLY (the -n dropped) | 1 failed | 56 passed | `a ZERO-BYTE `.wrapper` is read-nothing, not read-a-value — and decides nothing either` |
| the tick's whole current-account guard deleted | 3 failed | 54 passed | `a ZERO-BYTE `.wrapper` is read-nothing, not read-a-value — and decides nothing either`; `an UNREADABLE `.wrapper` never fabricates a move off the crossed account`; `the ABSENT halves of the two guards go OPPOSITE ways, and each way is pinned` |
| the tick reverts to the folding _home_for | 2 failed | 55 passed | `an UNREADABLE `.home` never fabricates a move off the crossed account`; `an UNREADABLE `.home` — built the ROOT-SAFE way, so this one is never skipped` |
| _home_measured stops falling back on an EMPTY value | 1 failed | 56 passed | `a ZERO-BYTE `.home` falls back like an absent one — the fallback is a DECIDED answer` |
| _swap_target stops answering nothing on an undecidable marker | 3 failed | 54 passed | ``_swap_target` stands still on an unmeasurable marker — the ROOT-SAFE twin`; `a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree`; `an UNREADABLE record stops `_swap_target` too — the marker survives AND the session stays` |
| the caller's re-seed gate reverted to -z crossed | 2 failed | 55 passed | `a marker path that is a DANGLING SYMLINK decides nothing — and no re-seed rides it`; `an UNREADABLE record stops `_swap_target` too — the marker survives AND the session stays` |
| empty/malformed collapsed back to one reason | 2 failed | 55 passed | `a MALFORMED marker record says so — the bytes were read and they name no pool`; `a marker whose OWN record is EMPTY ends with an honest reason, never a fabricated retag` |
| _reg_read's dangling-symlink arm narrowed to -e | 3 failed | 54 passed | `a DANGLING SYMLINK is rc 2, not rc 1 — it exists and cannot be read`; `a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree`; `a marker path that is a DANGLING SYMLINK decides nothing — and no re-seed rides it` |
| _reg_read's registry-level gate deleted | 2 failed | 55 passed | `a registry directory that is a REGULAR FILE is rc 2, not rc 1`; `an UNSEARCHABLE registry directory is rc 2 for every field — not rc 1` |
| _reg_read answers rc 1 for unreadable (the fold restored at the source) | 12 failed | 45 passed | ``_crosspool_valid` itself answers rc 2 — the third answer every consumer inherits`; ``_home_for` answers a DIFFERENT account for an unreadable `.home`, not an empty one`; ``_swap_target` stands still on an unmeasurable marker — the ROOT-SAFE twin`; `a DANGLING SYMLINK is rc 2, not rc 1 — it exists and cannot be read`; `a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree`; `a FIELD THAT IS A DIRECTORY is rc 2 — and this one works at every uid`; `a marker path that is a DANGLING SYMLINK decides nothing — and no re-seed rides it`; `an UNREADABLE `.home` never fabricates a move off the crossed account`; `an UNREADABLE `.home` — built the ROOT-SAFE way, so this one is never skipped`; `an UNREADABLE field is rc 2`; `an UNREADABLE record stops `_swap_target` too — the marker survives AND the session stays`; `standing still is SAID — once per episode, not once per tick` |
| _crosspool_tick's ABSENT-record arm deleted | 1 failed | 56 passed | `the marker record ABSENT at the read logs nothing — a race is not a reason` |
| _crosspool_valid's pre-gate loses || -L | 1 failed | 56 passed | `a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree` |
| _crosspool_tick's pre-gate loses || -L | 1 failed | 56 passed | `a marker path that is a DANGLING SYMLINK decides nothing — and no re-seed rides it` |
| _tick_undecidable loses its debounce (a line every tick) | 1 failed | 56 passed | `standing still is SAID — once per episode, not once per tick` |
| _tick_decided never clears the stamp | 1 failed | 56 passed | `standing still is SAID — once per episode, not once per tick` |
| the .home ABSENT polarity flipped to REFUSE | 1 failed | 56 passed | `an ABSENT `.home` is DECIDED, so a retag still ends the crossing` |
| the .wrapper ABSENT polarity flipped to ALLOW | 57 passed | **nothing — see below** |

**Eighteen of nineteen red.** The nineteenth is not a coverage gap but a NO-OP: flipping the
`.wrapper` guard's `[[ "$wrc" -eq 0 && -n "$wrapper" ]]` to `-ne 2` changes no behaviour, because
`_reg_read` prints nothing except on rc 0 — so `$wrapper` is empty whenever the rc is not 0 and the
`-n` conjunct already decides it. Both conjuncts ARE pinned individually (dropping `-n` reds the
zero-byte case; deleting the guard reds three), and the rc spelling is not independently observable.
Recorded rather than papered over with a case that could not fail.

Measured twice: once ordinarily, and once with every `it.skipIf(process.getuid?.() === 0)`
predicate forced true — a root run's exact effect. The two tables agree row for row, which is what
D-1997's root-safe cases were added to make true; before them, a root run reported GREEN over a
`_crosspool_tick` with every guard deleted.

## Verification

`server/test/ccd-crosspool.test.ts` — **57 passed**, from **32** at `origin/main`: 25 new cases.
Nine of them build real unreadability with `chmod 000` and carry
`it.skipIf(process.getuid?.() === 0)` (8 new, joining the pre-existing project-tag case); every
mechanism guard they cover also has a case that runs at EVERY uid, built with a directory in the
field's place — `cat` refuses it with EISDIR whoever runs it, and `-e` stays true so the read is
genuinely reached (D-1997).

At the tip, all three packages: **server 266 files / 7196 passed / 56 skipped / 0 failed**,
**agent 18 / 293**, **pwa 78 / 2167**. (That tip includes a merge of `origin/main` `d0064e6e` —
PR #66, account health and provenance — which landed mid-work and also edits `ccd/ccd`. Its only
conflict with C1 was the generated provenance marker on line 2, resolved by re-stamping the merged
bytes; the two changes touch disjoint functions, and both censuses below still measure the same
after it. Before that merge, C1 alone was server 260 / 7047, agent 18 / 292, pwa 78 / 2140.)

One tree-wide guard moved and is recorded rather than worked around: `ccd-pool-ok.test.ts` holds
`_pool_ok`'s header to its own census, and C1's new measurement paragraph in `_auto_swap_check`
names `_pool_ok` among the consumers of the value it measures — a PROSE mention, so the header's
line count went 17 -> 18 while its call-site count stayed 11. The header now states both, and says
which of the two moved and why.

Fixture HOMEs only (`makeCcdHarness`); no `ccd` verb ran against the live `$HOME`.

## After merge — and the embargo's real lift condition

The embargo does **not** lift on the merge sha (D-1999). `_crosspool_tick` runs inside the ~20
long-lived `ccd supervise` processes on the fleet box, and each holds the inode it was started
with: a merged commit changes nothing there. The lift condition is a successful
`bash deploy/deploy.sh agent <host>` **including its supervisor sweep**, which is what replaces the
running `ccd supervise` with one carrying this fix. Until that sweep has run, the shipped
`--cross-pool` verbs are still executing the pre-C1 expirer and the embargo stands exactly as wave
2b wrote it.

The sentence carrying the embargo has been deleted from `ccd/ccd`'s own header rather than
restated, and wave 2b's carry points here rather than repeating it — this document is its one
normative home. Account-pools wave 3 may then ship its `--cross-pool` server routes with the
marker's expirer no longer able to end a crossing off a read that failed, and with the shared
predicate no longer able to relocate a session off one.
