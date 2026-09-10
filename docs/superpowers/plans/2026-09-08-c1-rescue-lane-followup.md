# C1 follow-up — the guards straddled the rescue lane (#67 review)

**Base:** `origin/main` `db580771` (#67, C1). Branch `fix/c1-rescue-lane`.
**Why this exists:** the coordinator's review of #67 finished AFTER the merge and found six survivors,
one of which is a REGRESSION now on `main`.

**CORRECTED IN PLACE, because this paragraph will be read later as history.** It first said "the
operator ruled to HOLD the agent deploy until this lands, so the fleet is still on the pre-C1 inode and
nothing has shipped either defect." That was already false when it was written. Measured:

| what | value |
|---|---|
| `sha256 ~/.local/bin/ccd` | `501ab2b997034da1…` |
| `sha256 $(git show db580771:ccd/ccd)` | `501ab2b997034da1…` — MATCH |
| installed at | 2026-09-08 **21:10:30Z** |
| `ccd supervise` processes | **20**; 19 started **21:11:02–21:11:05Z**, one 21:17:22Z |

The operator's hold was ruled at ~21:32Z, twenty-two minutes after the install — a sound ruling on a
premise that was already false, and the premise was mine to check before I put the question. **And the
sweep ran**: every supervisor start time is AFTER the install, so the running processes hold the NEW
inode and C1 is EXECUTING on the box, not merely installed. That distinction is the one the embargo
paragraph was rewritten to make (D-2034) — `grep -n 'EMBARGO IT CARRIED' ccd/ccd`, by anchor rather than
by number, because this sentence said `:14876` while D-2034's own entry said `:14766` and the paragraph
has since moved twice more. Two line numbers for one rewrite, in one document, is not
a citation. It is the criterion D-1999 states — so the embargo is genuinely lifted, by the refined
criterion rather than the loose one.

**What that changes about this fix, and what it does not.** It is not a change landing before the risk
goes live; it lands on a box already carrying it. The fix itself is right for reasons that do not
depend on the premise. Exposure measured across all 26 registry rows, independently of the
coordinator's own count and agreeing with it: 0 missing / empty / unreadable `.wrapper`, 0 unreadable
`.home`, `$REG` searchable, 0 non-regular field files (so D-2030's hang is unreachable too). The one
absent `.home` answers rc **1**, not rc 2, so `_home_measured` falls through to `_id_wrapper` and
DECIDES. **Nothing trips either guard right now** — no rollback is warranted. But that is a
measurement of the STEADY state across one instant, and every trip condition is a state a row passes
THROUGH rather than rests in: a row mid-creation before `.wrapper` lands, a `.wrapper` removed out of
band, one tick of permission trouble. A five-second tick lives in the transient.

**Deviations DEFINED here:** D-2026–D-2035 (the original round), D-2155–D-2162 (the #69 review, round
2), D-2194–D-2207 (round 3), D-2212–D-2219 (round 3's #70 merge pass) and
D-2254–D-2261 (round 4), D-2283–D-2309 (round 5, the coordinator's round-4 gate) and
D-2312–D-2326 (round 5's own refute pass), D-2339–D-2341 (round 5's merge gate) and D-2343–D-2347
(the #73 merge's refute pass) and D-2348 (the hunk-header rule, booked by the coordinator and
rewritten here after its own refute pass). Every number is defined here and nowhere else.
**CORRECTED twice:** this sentence claimed only the first band for two rounds while the file went
on defining two more below it —
the header is the index a reader uses to answer "what does this plan own?", and it undercounted its own
contents by eight, then by twenty-two.

---

## The finding, in one paragraph

C1 put two guards at the TOP of `_auto_swap_check`:

```bash
wrapper=$(_reg_read "$id" wrapper); wrc=$?
[[ "$wrc" -eq 0 && -n "$wrapper" ]] || { _tick_undecidable "$id" wrapper; return 0; }
home=$(_home_measured "$id") || { _tick_undecidable "$id" home; return 0; }
```

and everything the LIMIT-RESCUE lane needs is BELOW them — `_swap_target` (`:12658`), `_strand_mark`
(`:12666`), the `auto-rescue` dispatch (`:12696`), all measured on the merged sha. So the guards did
not only refuse the crossing decision they were written for; they refused the whole tick. A session
whose `.home` merely became unreadable and then hit a limit was never evacuated: every five seconds,
forever, with no `.stranded` marker and no banner. On `origin/main` `_home_for` fell back to a valid
account and that rescue was entirely sound, so this is a regression and not a pre-existing fold.

**Why that is worse than what C1 fixed.** C1's own defect cannot bite today — the embargo means no
`.crosspool` marker exists on the box. This one bites on any live session. A fix for a dormant fault
must not open a live one in the most important behaviour `ccd` has.

---

## Deviations found

- **D-2026 (2026-09-08)** — **the guards straddled the rescue lane.** As above. The remedy is not to
  weaken them but to SCOPE them: `home` is an input to the CROSSING decision and to two shortcuts
  inside `_swap_target`, and to nothing the rescue needs. It is now measured without being fatal —
  `hrc` 2 skips `_crosspool_tick` entirely (no marker is deleted off a read that failed, which is
  C1's whole point), skips the pool re-seed, and is passed to `_swap_target` as a read code.
  The comment that stood above the guards also claimed more than it measured: "a transient failure is
  retried almost immediately" is true of a TRANSIENT failure and false of a PERMANENT one, which is
  retried forever and never succeeds.
- **D-2027 (2026-09-08)** — **`""` IS NOT A SAFE SENTINEL FOR `home`, and this is why the read code is
  an argument.** Measured, in a fixture: `_account_ok ""` is **TRUE**, because `_account_ok` is
  `[[ -x "$WRAPPER_DIR/$1" ]] && _lane_enabled "$1"` and `-x "$WRAPPER_DIR/"` tests the DIRECTORY,
  which is searchable. So the obvious shape — pass an empty `home` and let the existing guards fall
  through — walks straight into `_swap_target`'s home-recovered arm with an empty account name. That
  is D-1993's defect wearing this function's clothes, and it would have been introduced by the fix for
  D-2026. Pinned by `an unreadable .home never lets the session go BACK to it — the empty-name walk`,
  whose first assertion is the premise itself.
- **D-2028 (2026-09-08)** — **`_swap_target` answered two conditions with one value, and the caller
  handles them differently (#67 review S4/S5).** `return 0` with empty stdout meant BOTH "stay put,
  everything is fine" AND "the crossing record could not be read". At `:12666` an empty answer plus a
  hard-blocked pane becomes `_strand_mark` — a DURABLE POSITIVE CLAIM, written to `$REG/<id>.stranded`,
  read by the server onto the phone (wave 3 Task 3) and announced by a banner — that no account in the
  pool can take this session, when one demonstrably can. So C1 converted a fabricated RELOCATION into a
  fabricated STRAND, which is the worse end of the same defect: louder, durable, and more convincing.
  `_swap_target` now answers rc 2 for undecidable, and the caller strands with a cause that names the
  condition instead of borrowing `_strand_why`'s sentence.
- **D-2029 (2026-09-08)** — **standing still was said only where nothing reads.** `tick-undecidable`
  goes to `$REG/swap.log`, and **nothing in this product reads that file** — measured:
  `grep -rn 'swap\.log' server/src agent/src shared pwa/src` returns three hits and all three are
  COMMENTS. D-1995's argument ("standing still is SAID") is only true if something says it. The
  `wrapper` arm — the one value the tick genuinely cannot proceed without, because `cur` is
  `_swap_target`'s first input — now calls `_tick_strand_undecidable`, which marks `.stranded` and
  fires a banner **only when `_pane_hard_blocked` agrees the pane is really stuck**. That guard is the
  discipline: a session standing still on an unreadable field may be idle or perfectly happy, and
  marking it would be the same fabricated positive claim D-2028 removes one seam up.
- **D-2030 (2026-09-08)** — **`_reg_read` could HANG a supervisor, permanently.** C1 put `_reg_read`
  inside the `cmd_supervise` loop and it had no type check: `cat -- "$f"` opens whatever is at `$f`.
  A FIFO with no writer blocks in `open(2)` forever; a symlink to `/dev/zero` blocks in `read(2)`
  forever. No exit code, no stdout, nothing for anything to notice — strictly worse than any wrong
  answer the function could give. `_project_pool_state` already carries this precondition and the
  paragraph arguing it; `_reg_read` copied that function's LEVEL ORDER and dropped its loudest guard.
  Fixed with `[[ -f "$f" ]]` before the open — `-f` and deliberately NOT `-r`, because a `chmod 000`
  regular file must still reach the `cat`, fail there, and fall to the ladder that answers UNREADABLE.
  The case bounds itself with `timeout 5` in a child shell: a test for a hang must not be able to hang.
- **D-2031 (2026-09-08)** — **`cmd >> file 2>/dev/null` does not silence a failed redirect.**
  Redirections are applied left to right, so when `>>` fails bash reports "Is a directory" on a stderr
  that has not been silenced yet. Measured — the first spelling of `_tick_undecidable`'s append printed
  exactly that. `{ …; } 2>/dev/null` is the only spelling that keeps a failed append out of the
  supervise journal, which matters because this runs per row per five seconds.
- **D-2032 (2026-09-08)** — **the census sentence carried an instance of the class it was written to
  close (#67 review S6).** `ccd/ccd`'s `_reg_read` header said C1 "converted exactly ONE" `_reg_get`
  call site "and the other `_reg_read` calls are reads that had no `_reg_get` predecessor at all",
  citing D-2001 — which IS the misattribution class. Both halves are wrong. Re-measured against the
  pre-C1 tree (`git show d0064e6e:ccd/ccd`): `raw=$(_reg_get "$id" crosspool)` appears TWICE (in
  `_crosspool_valid` and `_crosspool_tick`) and `wrapper=$(_reg_get "$id" wrapper)` at the top of
  `_auto_swap_check`. THREE converted. Only `_home_measured`'s read has no predecessor, because
  `_home_for` survives beside it deliberately. A count is a measurement or it is decoration; this one
  was decoration, in the paragraph arguing against decoration.
- **D-2033 (2026-09-08)** — **`tickstuck` was a 33rd registry field missing from the file's own
  inventory**, in the comment that argues "an inventory that omits files is an inventory a future
  reader trusts and a future writer copies". `_reg_purge` is unaffected (it filters on the one-dot
  SUFFIX shape), so this is a documentation defect — but it is the exact omission that comment
  forbids, in the same file, in the same wave.
- **D-2034 (2026-09-08)** — **`ccd/ccd:14766` said the embargo was LIFTED, unconditionally**,
  contradicting D-1999 in the same PR that defined it. Between a merge and a completed agent deploy
  the source told anyone who grepped it — the operator, at exactly the moment they are deciding —
  that the embargo was clear while ~20 supervisors still executed the pre-C1 expirer. Now says what
  D-1999 says: lifted by a successful agent deploy INCLUDING its supervisor sweep.
- **D-2035 (2026-09-08)** — **the third structurally-unfalsifiable assertion of the day, in the case
  written to close a finding about observability.** `shFail`'s SUCCESS branch hard-codes
  `stderr: ''`, so `expect(r.stderr).toBe('')` is true for every command that exits 0, whatever it
  printed. Measured: the mutation it was written for left the suite green. Rewritten to redirect
  stderr to a file inside the snippet, which is the only place the real bytes exist. Its two
  predecessors today were D-2017 (a NUL assertion passing on the name grammar) and the plan's own
  W3-2 triage. Knowing the class by name did not stop me writing three.

### Also corrected, not its own number

`docs/.../2026-09-08-c1-crosspool-distinguishing-read.md`'s mutation row for `_swap_target`'s two
`return` guards claimed three reds; **deleting the second line alone leaves the suite fully green**
(57 passed, 0 failed — the review measured it and I reproduced it). All three reds came from the first
line. The row is corrected and the second arm now has its own case, built on the `FLIP` `_reg_read`
shadow this suite already uses.

---

## Mutation table — 9 mutations, 9 red

| # | mutation | RED case |
|---|---|---|
| A | the old `home` guard returns from the whole tick | `an unreadable .home still lets a limit-blocked session be RESCUED` (+ the empty-name walk) |
| B | the `wrapper` arm stops stranding | `an unreadable .wrapper STRANDS LOUDLY rather than standing still in silence` |
| C | `_tick_strand_undecidable` drops its `_pane_hard_blocked` guard | `…but NOT when the pane is merely quiet` |
| D | `_swap_target` folds undecidable back into stay-put | 4 cases, incl. the three rc assertions |
| E | the `strc == 2` arm stops stranding | `an undecidable crossing record strands with ITS OWN cause` |
| F | `_reg_read` drops the type check | `_reg_read refuses a FIFO on a TYPE check` (rc 124 = it hung) |
| G | the group redirect reverts to the trailing form | `_tick_undecidable is silent and harmless when its own log cannot be written` |
| H | the home-recovered arm drops its `hrc` guard | 2 cases |
| I | the debounce stamp is never written | 2 cases |

Measured one at a time, each reverted before the next, and each RED **named its predicted case** —
the check that caught mutation 4 of Task 3 landing on the wrong function earlier today.

---

## Not taken, reported

- The two the review knocked down (`rm -f` at `:14850` reachable through `pps`; the ABSENT/EMPTY
  carry) are NOT chased, per its instruction, and its reasoning was read at the cited lines.
- The `.project` fold (D-2000, defined in the C1 plan) was widened as **D-2009**, and **D-2017** is
  cited above in D-2035's own prose. Neither number is DEFINED on any ref this PR merges into:
  `git grep -n 'D-2009\|D-2017' origin/main --
  ':!docs/superpowers/plans/2026-09-08-c1-rescue-lane-followup.md'` returns nothing (the citing file
  now matches itself on `main`, so it has to be excluded), and both entries live only on the unmerged
  `ws/clear-meadow` wave-3 plan. **CORRECTED TWICE (round 3, D-2206).** Round 1 filed the dangling
  reference; round 2 "fixed" it by naming
  `docs/superpowers/plans/2026-09-05-account-pools-wave3-server.md` as the home — a file that exists on
  `origin/main` and contains neither number — which turned a repo-wide dead end into a directed one,
  and left D-2017 untouched. `deviation-refs.test.ts` is green throughout: it scans for COLLISIONS and
  floor seeding, and has no case for a number REFERENCED but nowhere defined.
  What is true before and after wave 3 merges, and is what this now says: **both numbers are allocated
  to account-pools wave 3, their entries land with that wave's plan, and neither is reachable from this
  branch.** The `.project` fold itself is a wave-3 DEPLOY PREREQUISITE by the coordinator's re-ruling,
  to be taken as its own small `ccd` PR — except for the half round 3 closed here, which is the fold's
  effect on the TICK (D-2199).
- The verb-gate scanner counts `CCD_ARGV.projectPoolClear('')[0]` — a NAME READ that is never run —
  as an ungated call site. That is wave-3 fallout, so the scanner fix travels with wave 3 and NOT with
  this PR, which stays the smallest `ccd` change that closes the regression.
  **CORRECTED (#69 review):** this said the site's file `server/src/pools.ts` "does not exist on
  `main`". It does — wave 2a landed it carrying `POOLS_DIR_NAME`, and `git show
  origin/main:server/src/pools.ts` prints it. What is not on `main` is the `PROJECT_POOL_VERB` line
  INSIDE it, which is the thing the scanner trips on. A file and a line in it are two claims.
- The `it.skipIf` suite still degrades silently under root. Taken as a mechanism in its own change,
  not folded here: it touches every skipped case in the file and this one must stay small.

---

## Round 2 — the #69 review (2026-09-09)

Five lenses on this PR, every finding then handed to a separate refute pass: **38 passes, 29
CONFIRMED, 9 PARTLY, zero refuted.** I re-verified all twelve independently before changing anything —
twelve reproduce-or-refute agents, each followed by a skeptic told to kill it and told specifically to
look for a proposed fix that would itself introduce a defect. **One finding died in that pass, and two
had their remedies corrected.** Deviations D-2155–D-2162.

- **D-2155 (2026-09-09)** — **the fold I removed for the crossing record was still there three lines
  below, on the condition that is actually live.** `_swap_target` answered rc 2 for an unreadable
  crossing marker and `return 0` for an unreadable POOL TAG, and the caller turned that empty answer
  into `cc swap STRANDED: <id> is blocked on <w> and no account in pool (untagged) can take it` with
  an in-pool account sitting free. **Both halves of that sentence are false**: the project IS tagged
  (`(untagged)` is `_strand_mark`'s `pdesc` default folding `unreadable` into untagged), and nobody
  found any account unable to take it, because nobody decided. It is the exact sentence the `strc == 2`
  arm was written to forbid for the sibling condition, and the PR's own R2 case asserts
  `.not.toContain('no account in pool')` for it.
  **The asymmetry that made it first:** the crossing record is inert on the box, and the pool tag is
  live — `ccd project-pool` writes it today and wave 3's Task 9 puts it a tap away. I fixed the
  dormant fold and left the live one.
  **TWO CORRECTIONS TO THE FINDING, from my own reproduction, and the first one matters more than the
  fix.** (1) The remedy is the SENTENCE, not the rescue. The finding's headline — "the rescue is
  skipped even when a healthy in-pool candidate exists" — is true but reads as if restoring the rescue
  were the answer. It is not: standing still on an undecidable tag is the ruled-correct safe side, and
  "fixing" the candidate loop to treat rc 2 as a pass is the constraint-lifting defect this tree
  names. The fix still strands; it strands honestly. (2) It is PRE-EXISTING —
  `origin/main:ccd/ccd` has the same `return 0`. What this PR added is the contract line declaring
  rc 0/2 and the caller's rc-2 arm, which is what turns an old rough edge into a contradiction of the
  function's own stated contract. In scope by argument, not by regression.
- **D-2156 (2026-09-09)** — **the strand this PR added could be set by the tick and never cleared by
  it.** `_tick_strand_undecidable` marks `.stranded` and the caller `return 0`s at the `wrapper` guard,
  ABOVE the tick's only automatic healthy-pane clear. Measured over five recovered ticks: marker
  byte-identical, zero `unstranded` lines. **And it is worse than the report said**: with a stale
  marker standing, `_strand_mark`'s own `[[ ! -e … ]]` debounce swallows every LATER genuine strand on
  that row — the commit whose thesis is that standing still must be SAID had made a class of
  standing-still permanently unsayable. The fix is one line at the second exit, gated on the SAME
  classifier the first exit uses; the line above it stays a bare return, because clearing on an
  unmeasurable pane is the fabricated clear C1 exists to prevent. Both halves pinned separately.
- **D-2157 (2026-09-09)** — **I closed the supervisor hang for `_reg_read` and opened it again through
  `_reg_get` in the same commit.** `_tick_strand_undecidable` reads `.project` through the
  un-type-checked `cat`, and the tick reaches `_reg_get` for `lastswap` and `swapblocked` too — so
  D-2030 closed two of five blocking reads and the comment read as though the class was shut.
  Fixed at `_reg_get` itself. **That is NOT the widening its own comment warns about**, and the
  distinction is the whole argument: the warning is about a THREE-ANSWER read, which would force 135
  callers to handle rc 2. A type check adds no distinction and narrows none — every input that answers
  today answers byte-identically — and the only inputs whose behaviour changes are the ones that today
  return no answer at all, none of which any ccd writer can produce.
- **D-2158 (2026-09-09)** — **`SessionRecord.stranded` does not exist on the tree this PR merges into.**
  Four of five lenses found it independently. Two comments justified the whole new lane with "the
  server reads it onto the phone (`SessionRecord.stranded`, wave 3)" — true only on `ws/clear-meadow`,
  my own unmerged branch. The PR REJECTS `swap.log` for having no reader and ADOPTS `.stranded` for
  having one, and on `main` they are in the same position. Corrected to say what is true on both sides:
  `notify.sh` fires today, the server reader lands with wave 3.
- **D-2159 (2026-09-09)** — **two guards on real conditions shipped unpinned, in the wave about unpinned
  guards.** Deleting `[[ -n "$hard_blocked" ]]` from the `strc == 2` arm strands a healthy idle session
  with all 1662 ccd cases green; mutating the `ctrc=2` initialiser to 1 destroys the once-per-episode
  debounce (five swap.log lines over five ticks) with the full sweep green. Both now have a case, and
  the `ctrc` one needed a TICK-level case because the helper-level R4 case calls
  `_tick_undecidable`/`_tick_decided` by hand and so pins the stamp but not who calls which.
- **D-2160 (2026-09-09)** — **four conditionals were no-ops, and they needed four different answers,
  not one.** The `hrc` wrapper around the second `_crosspool_valid` call is DELETED — it claimed to
  prevent a fold and prevented nothing (`cross_home` is read only inside the home-recovered arm, which
  carries its own gate), while suppressing an rc 2 arising between the two reads, which is a moment
  worth reporting. The `hrc` half of the `cur == home` test is KEPT with a sentence saying it decides
  nothing on its own and naming the gate that does. `[[ -n "$pane" ]] || return 0` is KEPT BARE and is
  now load-bearing under D-2156. A no-op is fine; a no-op presented as a guard is the defect.
- **D-2161 (2026-09-09)** — **journal noise went UP in the exact condition R4 protects.** The
  `{ …; } 2>/dev/null` fix reached `_tick_undecidable` and not `_strand_mark`, whose two `_reg_set`
  writes and own swap.log append are unwrapped — and the new path routes through both. Measured with
  `$REG` at mode 000: 5 unsilenced lines per row per tick against `origin/main`'s 3. Fixed at the one
  caller that runs every five seconds; `cmd_swap`'s `_strand_mark` stays loud, because an operator
  running a verb by hand should see a failed registry write.
- **D-2162 (2026-09-09; RE-MEASURED 2026-09-09 as D-2204, and the ground replaced)** — **one finding
  killed by reproducing it, then the killing argument itself killed by re-measuring it.** The report
  said `_tick_strand_undecidable`'s unconditional `tmux capture-pane` sits above `_auto_swap_check`'s
  two cooldown gates and adds an un-debounced fork every five seconds. Every mechanical claim is TRUE
  and the severity claim is FALSE — but the sentence written here to justify that was decoration. It
  said `_auto_compact_check`'s `lastcompact`/`lastswap` gates "read empty precisely because that row's
  registry is the unreadable thing", so the lane "doubles one already there, 10 → 20 per ten ticks, not
  0 → 10". Measured with a counting `tmux` first on PATH and the supervise loop's `live` arm run
  verbatim, 32 cells over eight trip shapes and four gate states:

  | row | pre-lane | with lane |
  |---|---|---|
  | healthy, ordinary steady state (control) | 2 | 2 |
  | healthy, `lastswap` younger than `SWAP_COOLDOWN` (900 s) | 0 | 0 |
  | `$REG` unsearchable — any gate state | 1 | 2 |
  | `.wrapper` absent / zero-byte / mode 000 / dangling / a directory / a FIFO, stamps stale or absent | 1 | 2 |
  | **the same six shapes, with either stamp younger than `COMPACT_COOLDOWN` (1800 s)** | **0** | **1** |

  **THE PREMISE IS TRUE OF THE REGISTRY-LEVEL SHAPES AND FALSE OF THE SIX `.wrapper`-ONLY ONES** — on
  the tree it was measured on. A tripped row never reaches `_auto_swap_check`'s own capture, so its
  whole pre-lane cost is the compact lane's, and that lane reads its gates with `_reg_get`, which needs
  only `$REG` to be enterable. The gates read empty precisely when `$REG` itself is the broken thing.

  **RE-MEASURED AGAIN ON THE #70 MERGE (D-2212, D-2213), WHICH MOVED IT.** #70 changed
  `_auto_compact_check`'s `lastswap` arm from `… && return 0` to `… && fromswap=1`: the lane no longer
  ends there, it falls through to its own `capture-pane`. So the compact lane now captures on exactly
  the ticks it used to skip. Measured on the merged tree, lane against lane-neutralised, over a grid
  **whose design was never recorded** — corrected here rather than guessed a fourth time (#69 review
  round 4 gate). This line said "3 `lastcompact` values x 4 `lastswap` values x 6 pane states", which is
  72; `ccd/ccd` said "both cooldown states and six pane states", which is 12; every result below is
  "of 36". The results are internally coherent (18 + 18 − 6 = 30, with remedy 3 gating on the swap
  cooldowns) and were measured — the DESIGN sentence was reconstructed afterwards and is the stale
  half. Read the cardinals as an order of magnitude, and re-derive the grid before re-deriving any
  fraction. The NO-FIX ruling does not rest on them: it rests on reachability, measured separately and
  re-measured independently at the gate.

  | quantity | pre-merge | merged |
  |---|---|---|
  | lane delta, every affected cell | +1 | +1 |
  | lane delta, healthy control | 0 | 0 |
  | healthy ceiling / ordinary steady state | 3 / 2 | 3 / 2 |
  | states where this capture is the tick's ONLY one (0 → 1) | 30 of 36 | **18 of 36** |
  | gate producing 0 → 1 | `lastcompact` fresh **or** `lastswap` fresh | `lastcompact` fresh **only** |
  | remedy 3 removes | (claimed: all) | **6 of 18 — 12 survive** |

  **AND THE CEILING CLAIM WAS SCOPED TO ONE OF TWO CALL SITES.** This is the third time this entry has
  restated a conclusion its own numbers no longer covered, and the cause this time is *our own round-3
  change*: R3 added a SECOND `_tick_strand_undecidable` call at the project guard. The re-measurement
  swept only the wrapper guard — every one of its 3,008 ticks returned there — and then stated the
  ceiling as a universal over "affected rows".

  On the seven WRAPPER-guard shapes the ceiling is **2**, and the mechanism is real: an unreadable
  `.wrapper` empties `_cfg_dir`, so `$sf` fails its `-e`/`-L` pair and the compact lane returns at
  `status-unreadable` two gates before its second capture. **On the PROJECT-guard class every premise
  of that sentence fails** — that row's `.wrapper` reads fine — so `$sf` resolves, the quiet gate
  passes, and the lane reaches the second capture: measured **3 captures per tick in 7 of the 36
  gate/pane states**, equal to the healthy ceiling, on ticks that compact for real. That class is also
  the one place the trip table's two independence claims break: it is neither pane-independent (`over`
  3, `under` 2) nor `lastswap`-independent (pane `mid`: 2 below `COMPACT_COOLDOWN`, 3 above).

  **WHAT SURVIVES IS THE DELTA, SAID WITH ITS CALL SITE.** +1 per affected row per tick, unmoved by the
  merge; wrapper-guard ceiling 2, below the healthy ceiling of 3; project-guard ceiling 3, equal to it.
  **The finding still does not need re-opening, and the reason is reachability rather than a ceiling:**
  `$POOLS_DIR` has exactly one `mkdir` in the tree (`cmd_project_pool`), the project guard is gated on
  `_pool_untaggable`, and the live fleet has no `pools/` directory — so that class cannot trip on any
  box today. It is one `ccd project-pool` away, which account-pools wave 3 will make ordinary. When it
  does, the number to quote is 3, not 2.

  **THREE remedies measured, all three defects** — correcting "both", which undercounted. (1) Gating on
  the `tickstuck` stamp shuts from tick 2 and reproduces `main`'s silence for the
  undecidable-then-blocked case the lane exists to catch. (2) Hoisting the call below the cooldown gates
  is unreachable from the branch it serves. (3) The one not considered — replicating those two cooldown
  tests INSIDE the lane — removes every 0 → 1 cell and is a defect twice over: a hard-blocked
  unmeasurable row that swapped within `SWAP_COOLDOWN` is not stranded at all, and a stale strand is not
  retracted when the pane recovers, so a healthy row wears a STRANDED banner for up to 900 s. **All 76
  cases stay green on it**, so it is a defect the mutation table cannot see.

  NO FIX — **and now DISCLOSED at the site**, which the first ruling omitted. This file's convention is
  that an accepted cost is written where it is paid (`grep -ci disclosed ccd/ccd` is the census, and
  it moves every round); a NO FIX whose disclosure lives only in a plan is a decision the next
  reader of the code cannot see.

### Corrections carried in the same round, without their own numbers

> **Three of the sentences in this paragraph were themselves wrong, and round 3 retracts them under
> D-2206** — the 135th call site was not C1's, the `_pool_ok` correction named the wrong function, and
> the `-eq 2` note was "corrected" by deleting its conclusion and keeping its false premise. Left
> standing as written, with this pointer, because the record of a round is what that round claimed;
> rewriting it in place would hide the pattern the next round needs to see.

The `_reg_get` census said 134 and its own command now yields **135** — the 135th is the call C1's
`_tick_strand_undecidable` added, in the paragraph rewritten to correct a count. `svcfailed` is a 34th
registry field and joins the inventory. The `_pool_ok` header moves 18/11 → 19/11 (prose only; the
call-site half has never moved). The navigation note saying "do not go looking for a literal `-eq 2`
branch inside `_auto_swap_check`; there is none" was falsified by C1 in the commit that left it
standing, and by this round again. `_swap_target`'s contract line declared two exit codes for a
function that returns three. And this plan's own claim that `server/src/pools.ts` "does not exist on
`main`" is false — the FILE is on main; the LINE the scanner trips on is not.

---

## Round 3 — the #69 review, second pass (2026-09-09)

**The coordinator's headline: "the fourth consecutive round in which the fix introduced a defect."** It
is right, and round 2's three were the worst of them because one was live on the ordinary path. What
follows is that round's own review, run the way the last one should have been: every finding reproduced
against the tree, and then every REMEDY handed to a separate skeptic told to kill it. **All six
remedies were killed, with measurements.** Every fix below is the survivor, not the first draft — and
one of the survivors was itself caught by an existing test while being written (D-2196).

### Deviations found

- **D-2194 (2026-09-09)** — **the tick's verdict sat above the answer it needed, and the round that
  added the answer did not move it.** `_auto_swap_check` decided its voice from THREE reads and cleared
  the `tickstuck` stamp on every tick where the crossing read decided — which is every row with no
  crossing marker, i.e. every row on the box. Round 2 then added a FOURTH undecidable source, the
  project's pool tag, 108 lines below, which re-wrote the stamp the verdict had just deleted. Measured
  on a fixture row with an unreadable tag and a QUIET pane: one `swap.log` append, one `_reg_set` (tmp
  write + atomic rename) and one `rm` per row per five seconds, for ever, into an unrotated file — and
  on a healthy pane, because `_strand_mark` is gated on `hard_blocked` and the tick's voice is not.
  The comment naming the invariant ("the only place that has all three answers") and the line breaking
  it shipped in the same commit. **The verdict now runs once, after `prc`**, with no `return` between
  the reads and it.
  **Reachability, corrected against the report that filed it:** it is ARMED IN CODE and DORMANT ON THIS
  FLEET. Read-only census of the live registry: 27 rows, 0 crossing markers, 0 stamps, **no `pools/`
  directory** — so every project reads `untagged`, `_pool_ok` returns 0, and the arm is unreachable
  today. The finding said "live on healthy rows"; it needs one more condition than that, and the
  condition is one tag away. `swap.log` is 617,946 bytes and nothing rotates it.
- **D-2195 (2026-09-09)** — **an episode is a condition, not a file.** The debounce tested bare
  EXISTENCE of the stamp, so with four callers naming four fields the FIRST condition on a row silenced
  every later one for as long as the stamp stood — and `ccd` never re-chmods a registry file, so "as
  long" can be for ever. Measured: a row whose `.home` went unreadable and then recovered onto an
  unreadable pool tag logged the home episode once and the pool episode **never**, while the stamp went
  on naming a condition that had ended. This is the same shape as the stale `.stranded` marker round
  2's own S2 fix retracts one function down, and it gets the same answer: compare the stamp to the
  condition. Read through `_reg_read`, not `_reg_get` — folding "stamp unreadable" into "no stamp"
  would restore the storm through the fold instead of through the clear.
  **Disclosed residual:** a field that FLAPS between two values on successive ticks now logs on every
  flip. Two faults alternating at 5 s, and the result is loud rather than silent.
- **D-2196 (2026-09-09)** — **the fix's own regression, caught by a test the fix did not write.**
  Moving the clear below `_swap_target` is right; leaving it ungated is not. An `hrc` 2 row reaches
  that line with a perfectly good destination — `_swap_target` skips the home arm and ranks the pool
  loop instead — so an unguarded clear retracts, every tick, the stamp the verdict just wrote. Five
  ticks, five lines: **the storm being removed, reintroduced 100 lines below its own removal.**
  `ccd-crosspool.test.ts`'s existing S5 case went red on it. Booked with its own number because it is
  the fifth consecutive instance of the pattern this round exists to break, and it was caught by
  mechanism rather than by care.
- **D-2197 (2026-09-09)** — **D-2157's hang class was half closed, and the half left open is on the
  same tick.** `_authdead` cats `$REG/<account>-authdead` with no type check, and round 2's `_reg_get`
  guard cannot reach it: that path is DOTLESS, not `$REG/<id>.<field>`. Measured on the shipped body
  under `timeout 5`: a FIFO with no writer and a symlink to `/dev/zero` each returned **rc 124**. Both
  call sites are inside ACCOUNT loops, so one bad file wedges the tick of every row that reaches the
  loop, not just the row on that account. Fourteen inputs measured identical before and after. The fold
  it keeps — unreadable answers "not condemned" — already existed for `chmod 000`, is spent on
  PREFERENCE only at both consumers, and folds toward "a rescue must always have a destination".
- **D-2198 (2026-09-09)** — **and the sweep the coordinator asked for found a second one.**
  `grep -oE … "$sf"` on the session-status file opens by name and blocks for ever on a FIFO or an
  unbounded character device — a read neither `_reg_get` nor `_reg_read` can guard, because it is not a
  registry field. Both tick lanes carry it. Measured with a stubbed tmux: the compact lane hung at 6 s
  on a FIFO and on `/dev/zero`; with the guard both answer NOOP and the idle+quiet positive control
  still fires. **Reported and NOT taken, each needing a decision rather than a reflex:** the ten
  tick-reachable `>> "$REG/swap.log"` appends (a bare `-f` guard would silently DROP the line, which
  collides head-on with D-1995 — the right shape is one `_swaplog` writer with one guard and a fallback
  channel); `"$REG/notify.sh"`, where `-x` is not a type check and there is no timeout; and
  `source "$CCRC_ACCOUNTS_SH"`, which is guarded `-e`+`-r` but not `-f` and hangs `ccd supervise`
  before its loop starts — arguably the highest-value one left, and its two `die` messages are pinned
  by four suites, so adding a rung means deciding which message a non-regular roster gets.
- **D-2199 (2026-09-09)** — **the `-f` guard round 2 added to `_reg_get` turned a loud failure into a
  silent constraint lift, at the one site where the fold decides something.** `_reg_get` folds
  UNREADABLE into `""`, `_project_pool_state` answers `untagged` for `""`, and `untagged` is the ONE
  state `_pool_ok` admits every account under. Measured with `demo` tagged `pool-a` and `.project` a
  FIFO: `auto-rescue claude-demo: claude (blocked) -> claude-b`, dispatched, out of its pool, with no
  strand and no line — where the measured tag refuses every out-of-pool candidate and strands by name.
  **And worse than filed:** the same fold reaches `_crosspool_tick`, whose guard sees the folded
  `untagged` rather than the unreadable it is, **DELETES a deliberate crossing marker** and logs
  `crosspool-ended <id>: project pool is now untagged` — a destructive act on a false reason. Both
  reads, the caller's and `_swap_target`'s own, now measure. ABSENT and EMPTY still mean untagged;
  only rc 2 stops the tick.
- **D-2200 (2026-09-09)** — **and the obvious fix for D-2199 is the #67 R1 shape, so it is gated.**
  Refusing on an unreadable `.project` unconditionally kills the limit rescue on every box that has
  never tagged a project: `$POOLS_DIR` has exactly one `mkdir` in the tree, so until then
  `_project_pool_state` answers `untagged` for EVERY name, the unread field could not have changed the
  verdict, and the rescue is fully sound. Measured: with `pools/` absent and `.project` a FIFO, the
  patched-without-the-gate tree performs NO rescue and writes a fabricated strand. `_pool_untaggable`
  is the one predicate that answers "could any project here be in a pool at all", and it restates
  `_project_pool_state`'s own first two levels in its order and for its reasons. The suite carries the
  case in the OPPOSITE direction — no `pools/`, unreadable `.project`, hard-blocked pane, **the
  dispatch still happens** — or the regression would be unmeasurable.
- **D-2201 (2026-09-09)** — **round 2's S2 fix was half a fix, and the half it missed is the ordinary
  one.** It retracts a stale strand only through a HEALTHY pane. When the unreadable field recovers
  while the pane stays blocked — a 429 banner standing for a five-hour window — no healthy tick ever
  intervenes, and `_strand_mark`'s `-e` debounce swallows the genuine strand that follows: the row wears
  "wrapper could not be measured" for the whole window while the truth is a pool census. **Said in two
  halves, because only one is true on the tree this merges into** — and getting that split wrong is
  what #69's S4 finding was about, so writing it wrong again here would be the fourth instance of the
  very pattern this round is convened over. TODAY the cost is the marker file and the missing
  `swap.log` line, the box's own forensic trail; the banner recomputes its sentence from a fresh
  reason on every firing and already tells the truth. WHEN wave 3 lands its reader the marker becomes
  `SessionRecord.stranded.reason`, carried VERBATIM to every ccrc surface — measured:
  `git grep -c stranded server/src/registry.ts` is **0** on `origin/main` and on this PR branch, **12**
  on `ws/clear-meadow`. The fix earns its place on the first half alone. **The marker is a
  CURRENT-STATE claim and now follows the truth; the swap.log line keeps its per-episode floor, the
  banner keeps its `SWAPBLOCK_COOLDOWN` floor, and the episode keeps its own epoch** — `stranded.at` is
  "since when", and re-stamping it would make a four-hour strand read as new on every tick. A marker
  rewrite cannot storm: it is one tmp-plus-rename over one file. The append is not keyed on the reason
  precisely because the reason CAN change tick to tick.
- **D-2202 (2026-09-09)** — **and the obvious spelling of D-2201 walks into this program's own named
  defect.** Reading the previous cause with `_reg_get` folds a marker that is a directory, a FIFO or
  mode 000 into the same `""` an EMPTY one gives — so the branch would commit a WRITE to a path it had
  proved only `-e` for. Measured: one unsuppressed `mv: cannot overwrite directory` per stranded row
  per tick, for ever, from the two `_strand_mark` call sites in `_auto_swap_check` that carry no
  redirect group. `_reg_read` stands still on rc ≠ 0 — and nothing is lost by not repairing the
  marker, because wave 3's reader fail-shuts an unreadable one to `STRANDED_UNREADABLE` rather than
  trusting it. (That reader is on `ws/clear-meadow`, not on this branch; stated as the future half
  deliberately, per D-2201.)
- **D-2203 (2026-09-09)** — **D-2161's stderr group was the one change of eight that was never
  mutated, and nothing in the tree could red it.** With the group deleted the whole ccd sweep is green;
  the only red is `ownership.test.ts`'s provenance stamp, which reds on ANY byte change and so is a red
  naming the wrong case. It is now pinned the root-safe way (D-1997): `swap.log` planted as a DIRECTORY
  makes the append fail with "Is a directory" at every uid, where `chmod 000` is a no-op for root — and
  that is the exact failure the sibling comment says the spelling exists to catch, so the pin measures
  the argument the code makes. **The comment's own measurement DOES reproduce** (5 / 0 / 3), and three
  things around it did not: it repeats every tick rather than once per episode, because `_strand_mark`'s
  `-e` debounce cannot stat anything at mode 000 (15 lines over 3 ticks, not 5 then 0); it is not "the
  only caller that runs every five seconds", since `_auto_swap_check` calls `_strand_mark` twice with no
  group, disclosed here rather than fixed; and `origin/main`'s 3 are `_tick_undecidable`'s, a different
  function's cost, since `main` carries no strand arm at all. **`_strand_clear` stays outside the
  group** — the round-2 review asked for it to move in, and at mode 000 its own `-e` test is false so it
  writes nothing; the only shape where it does write is a read-only `$REG`, and there the same two lines
  come from `_auto_swap_check`'s ordinary healthy-pane clear on every tick of every healthy session,
  which `origin/main` does too. Moving the rarest of six call sites inside would silence two lines
  nobody is seeing and leave the common one untouched.
- **D-2204 (2026-09-09)** — **D-2162's measurement was decoration, and the round's own words convict
  it: "a count is a measurement or it is decoration."** Re-measured in full above, in that entry. The
  refutation stands on a better ground the entry never stated — the ceiling, not the doubling — and the
  first re-measurement's replacement mechanism ("the CORRELATED case") was itself false and is gone.
  The NO FIX is now disclosed at the site in `ccd/ccd`, in the idiom this file already uses throughout
  (`grep -ci disclosed ccd/ccd`).
- **D-2205 (2026-09-09)** — **the sentence licensing a change to every `_reg_get` call site was false,
  and the case written to pin it certified a history that did not happen.** The comment said every
  enumerated input answers "rc 1 either way" and named `/dev/null` among the five; `cat /dev/null`
  exits 0, so that one input goes **rc 0 → rc 1**. The pinning case was titled "and every input that
  answered before still answers the SAME" and its own last assertion measured the input that does not,
  with a message saying it had been "refused on content before" — it was not refused at all.
  **What actually licenses the change is a property of the CALLERS, and it is measurable clause by
  clause:** all 133 invocations sit inside `$(_reg_get …)`; none outside a capture; none followed by a
  read of `$?`; the twenty-eight lines carrying `||` or `&&` all test the captured STRING inside
  `[[ ]]`; and no assignment from the capture is followed by `||` or `&&`. No call site can see the
  exit code at all. That is now the argument, and a new case reds if the first rc-consuming caller
  appears.
- **D-2206 (2026-09-09)** — **the misattribution sweep, and it is the third round running that one of
  these was a failed CORRECTION rather than fresh drift.** (a) The `-eq 2` navigation note: round 2
  deleted its closing sentence and left its premise, so the paragraph asserted P three lines above ¬P —
  `_auto_swap_check` tests `-eq 2` on `prc`, and the `prc` it tests is the one assigned by the
  `aff_verb` `_pool_ok` call the sentence named as testing only `-eq 1`. Rewritten, not appended
  to. (b) The
  D-2009 "correction" named a file containing no D-2009 on any ref this PR merges into, and D-2017 was
  never touched — both retracted above. (c) The `_pool_ok` census attributed its new prose mention to
  `_swap_target`'s candidate loop; the line is in `_auto_swap_check`, and the candidate-loop paragraph
  matches the grep zero times. (d) A comment quoted `_pool_ok "$cur" "$pps"; [[ "$prc" -eq 2 ]] &&
  return 0` verbatim for a line the same PR had changed to `return 2` — now cited by grep anchor. (e)
  "the crossing record answers eight lines up" — no reading of the block yields eight; cited by anchor.
  (f) "`_reg_read`'s ladder does two extra stats on every MISS" — strace measures **four**, and it is
  the sole quantitative justification for diverging from a pattern this tree names as doctrine. (g) The
  135th `_reg_get` site was attributed to C1; `_tick_strand_undecidable` does not exist in C1's commit
  — it was added by this PR's own pre-review commit. (h) "the one direct writer (`.svcfailed`)" —
  `_pr_py` writes four more field files inside the same file. (i) The `_reg_get` hang-surface
  enumeration named three fields; the tick's real surface was at least six, and it included `wrapper`.
- **D-2207 (2026-09-09)** — **`_reg_purge`'s inventory is complete for the shape it measured and its
  sentence claimed a wider one.** "Measured against every registry file a session has today" is false:
  `$REG/.<id>.starts`, the start-limiter window, leads with a DOT, so the loop's `"$REG/$id".*` glob
  cannot match it and neither explicit `rm -f` names it. Disclosed rather than fixed — it is a handful
  of bytes per reaped row, it belongs to the start limiter, and widening the glob changes what
  `_reg_purge` MEANS, since the nested-id guard turns on that glob's shape. The paragraph whose own
  moral is "an inventory that omits files is an inventory a future reader trusts and a future writer
  copies" is not the place to claim a completeness nobody measured. The suite now requires the
  disclosure to be present, not merely the scope narrowed.

### Mutation table — 11 mutations, 11 red, each red naming its own case

| # | mutation | predicted red | measured |
|---|---|---|---|
| M1 | restore the verdict's clear above the pool answer | 5 lines from 5 ticks | RED — `expected […(5)] to have a length of 1 but got 5` |
| M2 | `_tick_undecidable` debounces on bare existence again | the 2nd episode is swallowed | RED — `expected [Array(1)] to have a length of 2 but got 1` |
| M3 | un-gate the clear from the verdict | 5 lines on an `hrc` 2 row | RED — `one line, whatever _swap_target found: … got 5` |
| M4 | delete the clear entirely | the stamp never lifts | RED — `a decided row carries no stamp: expected '… pool' to be null` |
| M5 | `_authdead` opens without `-f` | rc 124 | RED — `expected 'rc=124' to be 'rc=1'` |
| M6 | the status-file grep without `-f` | rc 124 | RED — `expected 'rc=124' to contain 'rc=0'` |
| M7 | fold BOTH `.project` reads | a cross-pool dispatch | RED — `expected 'dispatch claude-demo -> claude-b' not to contain 'dispatch'` |
| M8 | drop the `_pool_untaggable` gate | the rescue stops firing | RED — `the rescue still fires: expected '' to contain 'dispatch'` |
| M9 | delete the cause-rewrite branch | the stale cause stands | RED — `expected '1700000000 wrapper could not be measu…' not to contain …` |
| M10 | read the old cause with `_reg_get` | stderr per tick | RED — `expected […(3)] to deeply equal []` |
| M11 | remove the `{ …; } 2>/dev/null` group | one "Is a directory" line | RED — `expected [Array(1)] to deeply equal []` |

**M7 is the row worth reading twice.** Folding only ONE of the two `.project` reads still reds the
case — but on the *message* assertion, not the dispatch, because `_swap_target`'s own guard catches
what the caller let through and then names the wrong condition (`crosspool`, since `pps` folded to
`untagged` and `prc` came back 0). The two guards are not redundant: either alone prevents the
relocation, and only both produce a true sentence about why. A one-site mutation here would have
measured green on the harm and red on the wording, which is the "red naming the wrong case" trap this
table exists to catch — found by running it rather than by reading it.

---

## Round 3, the #70 merge pass (2026-09-09)

`origin/main` moved to `2b278a05` (#70, the compactor) while round 3 was being cut, and the coordinator
stopped the round to say so. It was right to: **#70 did not merely date the prose, it broke one of this
round's fixes and moved three separate measurements.** Everything below was found after the merge, and
two of the four code findings were found by a TEST rather than by anyone reading the diff.

The mechanism behind almost all of it is one line. #70 changed `_auto_compact_check`'s `lastswap` arm
from `… && return 0` to `… && fromswap=1`: the compact lane no longer ends there, it falls through to
its own `capture-pane` and, below that, to a `_compact_note` writer that did not exist before. A guard
that was behaviour-identical against a line which only returned is not behaviour-identical against a
line that records something — and that sentence is the whole of D-2214.

### Deviations found

- **D-2212 (2026-09-09)** — **D-2162's table, re-measured a third time, because the merge moved it.**
  With the `lastswap` arm no longer returning, the states in which this lane's capture is the tick's
  ONLY one shrank from 30 of 36 to **18 of 36**, and the gate for them is now `lastcompact` fresh ALONE
  rather than either cooldown. The delta is unmoved at **+1 per affected row per tick**, and the healthy
  control is unmoved at ceiling 3 / steady state 2. **Remedy 3 no longer even removes the class it was
  rejected for removing badly**: replicating the swap cooldowns inside the lane now clears 6 of those 18
  cells and 12 survive. Every per-tick cost figure taken before this merge understates the in-cooldown
  compact tick — measured with strace, 2 → 23 process spawns and 0 → 2 write paths on a declining tick.
- **D-2213 (2026-09-09)** — **the ceiling was measured on one of two call sites and stated as a
  universal, and the second call site is ours.** Round 3's own R3 fix added a `_tick_strand_undecidable`
  call at the project guard. The re-measurement swept only the wrapper guard — all 3,008 of its ticks
  returned there — and concluded "no affected row rises above the ordinary per-row cost". On the
  project-guard class every premise of that fails: the row's `.wrapper` reads FINE, so `_cfg_dir`
  resolves, `$sf` exists, the quiet gate passes, and the compact lane reaches its second capture.
  Measured **3 captures per tick in 7 of 36 gate/pane states**, equal to the healthy ceiling, on ticks
  that compact for real; and that class is neither pane-independent nor `lastswap`-independent, both of
  which the table asserted. **This is the third time this entry has restated a conclusion its own
  numbers no longer covered** — and it would have frozen a fabricated universal into a source comment.
  The finding still does not need re-opening, but on REACHABILITY, not on a ceiling: `$POOLS_DIR` has one
  `mkdir` in the tree, the guard is gated on `_pool_untaggable`, and the live fleet has no `pools/`
  directory. When wave 3 makes tagging ordinary, the number to quote is 3.
- **D-2214 (2026-09-09)** — **the merge turned one of this round's own guards into an adapter that
  narrows a distinction it received.** R2 put `[[ -f "$sf" ]] || return 0` before the session-status
  grep, and measured it behaviour-identical: absent, a directory, a `chmod 000` file and `/dev/null` all
  made `grep` produce nothing, `st` stayed empty, and the line below already returned 0. #70 turned that
  line into `_compact_note "$id" status-unreadable`, deliberately distinct from `not-idle`. So the guard
  silently swallowed the new distinction for exactly the inputs it newly admits, in the lane whose whole
  point is telling "I could not read the status" from "the status said busy". Caught by
  `ccd-auto-compact.test.ts`'s D-2013 case on the merge, not by reading it. The guard now feeds #70's own
  vocabulary and tells ABSENT from NON-REGULAR — the first repair said "not a regular file" about a file
  that was simply absent, which the same case caught one iteration later. `_auto_swap_check`'s copy keeps
  the bare `|| return 0`, correctly: that lane has two answers and no note vocabulary to narrow.
- **D-2215 (2026-09-09)** — **the thirteenth read, in a function an earlier census had already
  cleared.** `_lc_err` bumps the counter that exists to report that the lifecycle journal could not be
  written — and it opened `$_LC_DIR/errors` with a bare `cat` and no type test of any kind. It is on the
  5-second tick: `_auto_swap_check`'s `_lc_done rehome` → `_lc_emit` → five arms that call `_lc_err`, one
  of them the failure arm of the journal append itself. **Measured rc 124** under `timeout` both directly
  and through `_lc_emit` with the journal directory unwritable. The sweep that cleared `_lc_emit` did so
  on `_lc_live`'s guard over the journal GLOB and never looked at the failure arm of the append it was
  clearing — a census that named the chain, listed two of its three hazards, and dropped the third. The
  fold is the one this function already wants: `errors` is documented as a FLOOR, and the regex below the
  read restarts the count on anything that is not digits, so a non-regular file lands where a garbage one
  already did.
- **D-2216 (2026-09-09)** — **the merge resolution left a second, malformed provenance marker in the
  shipped file, and `verifyMarker` said `ccrc-unmodified`.** Resolving the line-2 conflict wrote a
  `# ccrc:generated 1 sha256=PLACEHOLDER` line and then re-stamped; `markGenerated` strips the marker it
  finds and inserts a fresh one, so the placeholder survived as line 3 — inside the hashed body, which is
  why the digest verified and every suite stayed green. A marker check that passes is not a check that
  the file has one marker. Deleted.
- **D-2217 (2026-09-09)** — **two counts this branch had just corrected were moved again by the same
  merge.** `_compact_note` reads `compactskip` and `compactnote` on every declining tick, so the
  `_reg_get` census went 133 → **135** and the tick's hang-surface enumeration gained two fields. The
  merge reconciled `_reg_purge`'s cardinal in the same commit (34 + 2 = 36) and left these standing —
  which is exactly what that comment's own "re-measure it" exists to catch, and the reason a count is
  written next to the command that produces it.
- **D-2218 (2026-09-09)** — **a citation falsified in the OPPOSITE direction: #70 cited us, and we
  changed underneath it.** `_compact_note`'s comment said its epoch is "when this reason became current
  (`stranded`'s own meaning)". That was true when written — on `origin/main` `_strand_mark` wrote its
  marker only when ABSENT, so "when the episode began" and "when this reason became current" were one
  sentence. R4 then added the rewrite arm that replaces a CHANGED cause while PRESERVING the original
  epoch, because `stranded.at` is shipped as "since when". `compactskip` has no such reader and wants the
  opposite. Two markers, one shape, two epoch contracts — and no test can see this one, which is why it
  is booked rather than left.
- **D-2219 (2026-09-09)** — **the reads are closed; the WRITES are the open class, and the merge put one
  on the ordinary tick.** Eleven tick-reachable `>> "$REG/swap.log"` appends, the `notify.sh` exec and
  the auto-rescue limits stamp each measure **rc 124** against a FIFO. #70 added the twentieth-to-
  twenty-first append (`_compact_note`), and it is the first that fires when nothing is wrong — the
  compactor merely declining is the steady state of a healthy busy session, so the tick's operator-facing
  write is no longer conditional on a fault. **Disclosed, not taken:** a bare `-f` rung here would
  silently DROP an operator-facing line, which collides head-on with D-1995 ("standing still is only
  acceptable if the standing still is SAID"). The right shape is one `_swaplog` writer with one guard and
  a fallback channel, across all twenty-one sites — its own finding, its own number, and not a reflex.

### Mutation table — the merge pass

| # | mutation | predicted red | measured |
|---|---|---|---|
| M12 | collapse the status-file ladder to `[[ -f "$sf" ]] \|\| return 0` | no note at all, and #70's own case | RED ×2 — `expected '' to contain 'status-unreadable'` and `expected null to be 'status-unreadable'` |
| M13 | remove `_lc_err`'s `-f` rung | rc 124 | RED — `expected 'rc=124' to be 'rc=0'` |

**What the merge pass did NOT break, measured rather than read:** R1 is clean — #70 added no `return`
between the tick's reads and its verdict, the verdict still sees all four answers, and `tickstuck` has
three code sites, none of them #70's. R3's `.project` / `_pool_untaggable` path is untouched. R2's
`_authdead` half is safe: both callers consume it as a bare boolean, with no vocabulary to narrow.

---

## Round 4 — the review of round 3 (2026-09-09)

The coordinator's review of round 3: 7 lenses, 49 findings, **43 CONFIRMED / 6 PARTLY / 0 REFUTED**, 24
blocking. Its two CRITICALs about the merge and about `SessionRecord.stranded` were already closed by
the merge pass (D-2214, D-2201) — found independently, hours apart, which is the mechanism working
rather than a coincidence worth celebrating. What follows is the rest.

**The through-line of this round is that round 3's fixes were correct and incomplete in the same way
three times over:** each closed a defect at the seam it was looking at and left, or created, the same
defect one seam over. That is not carelessness. It is what a dense change in a hot loop costs when the
fix is designed against the site that reported the bug rather than against the whole path.

### Deviations found

- **D-2254 (2026-09-09)** — **an overloaded exit code at a seam, and round 3 added the fourth
  condition.** `_swap_target` answers rc 2 — "nobody can say" — for FOUR distinct conditions: the
  crossing record on `cur` and on `home`, `_pool_ok "$cur"`, and the `.project` re-read round 3 added.
  The caller INFERRED which from `hrc` and `prc`, two measurements of two DIFFERENT moments than the
  one that refused, and defaulted to `crosspool`. Measured end to end with the field broken between the
  caller's read and the callee's — the exact TOCTOU race the inner read exists for: the row stranded
  naming `.crosspool`, a file the fixture never created, and stamped the debounce `crosspool`, so the
  next genuine crossing episode was swallowed too. **`hrc` is not one of the four at all** — it is
  tested nowhere inside `_swap_target` — so the comment claiming "measured, not guessed" named a
  condition the function does not have and omitted the one that had just been added. Round 3 closed
  this exact shape for `hrc` and opened it for `project` in the same commit.
  **The exit code now carries the answer** (2 crossing, 3 project, 4 pool). The other two channels were
  measured and rejected rather than waved away: a well-known variable dies with the command
  substitution's subshell, and a second stdout token puts a cause word where a destination lives and
  reds four existing `rc=2` pins. Crossing KEEPS rc 2, so every existing rc-2 assertion stays green by
  construction; `-ge 2` and an `rc$strc` arm make a future fifth code loud instead of silent.
- **D-2255 (2026-09-09)** — **two surfaces, two files, one tick.** `_tick_undecidable` writes the WORD
  and `_strand_mark` writes the SENTENCE, and they were computed separately — so on a row where the
  crossing record AND the pool tag were both unreadable, the stamp said `crosspool` while the strand
  sentence said the pool tag. That one is not a race; it is ordinary double-fault state. Both surfaces
  now derive from one word through `_undecidable_cause`, so they cannot drift. Removing that coupling
  reds three cases, two of them pre-existing.
- **D-2256 (2026-09-09)** — **the storm fix inverted the defect.** Round 2 stormed because the clear ran
  BEFORE the setter; round 3 moved the clear to the bottom of the tick and so left it below four
  `return 0` gates — a fault that ENDS while a gate holds leaves a stale stamp, and the debounce then
  swallows the next genuine episode of that field. Measured: tag breaks (one line), tag fixed, row
  swaps, tag breaks again inside `SWAP_COOLDOWN` — second episode silent. **The two cooldown gates now
  clear** (a fresh `lastswap` means the row swapped; a fresh `swapblocked` means it tried and was
  refused — both are decisions), **and the pane gate deliberately does not**: an empty capture is a row
  nothing was measured about, and it is the one gate here that can hold indefinitely, which is exactly
  why it must not be the one that clears on a guess. Pinned in both directions — and the first spelling
  of the pane-direction case was VACUOUS: with the condition still true the verdict re-set `$stuck`
  every tick, so a wrongly-added clear was gated off anyway and the mutation passed. It had to end the
  condition first to measure anything.
- **D-2257 (2026-09-09)** — **round 3 fixed the tick and left the verbs, which are the half a PWA tap
  reaches.** `cmd_swap` and `cmd_prefer` still read `.project` through `_reg_get`, so an unreadable
  field folded to `untagged`, `_pool_ok` admitted every account, and both `die` arms were skipped:
  measured, `demo` tagged `pool-a` with `.project` a FIFO printed `swapped claude-demo: claude ->
  claude-b`, wrote the new wrapper and recorded no crossing marker. `cmd_prefer` is worse — it rewrites
  `.home`, so it PINS the session out of pool rather than moving it once. A verb may `die` where the
  tick must stand still, and the two lines below already `die` on an undecidable pool TAG, so this is
  the same condition one level down in the same voice. Gated on `_pool_untaggable` in both, with the
  opposite-direction case pinned: no `pools/` dir, unreadable `.project`, the swap STILL happens.
- **D-2258 (2026-09-09)** — **and the claim that this branch created that defect is false for three of
  its five inputs.** Measured on `origin/main` itself, same fixture: `.project` as a DIRECTORY, a
  DANGLING SYMLINK or `chmod 000` already relocated silently out of pool there. Those were never a
  hang, and they are not this branch's either: they are on `origin/main`, so whatever put them there
  predates every commit here, and nobody closed it. **CORRECTED (#69 review round 4 gate):** this
  read "they are the round-2 constraint lift reaching the verb" — attributing a measured
  PRE-BRANCH condition to this PR's own round 2, inside the entry written to stop exactly that
  attribution. The measurement was right and the provenance clause was not. What this branch
  changed is the other two: a FIFO blocked in `open(2)` on main and a symlink to `/dev/zero` in
  `read(2)`, and the `-f` added to `_reg_get` turned both hangs into the same silent move. **The branch
  widened the hole from three shapes to five; it did not open it.** Booked separately because the first
  draft of the fix's own comment asserted the stronger claim, and a fix that overstates what it repairs
  is how the next reviewer's baseline goes wrong.
- **D-2259 (2026-09-09)** — **eight guards mutated one at a time; four could not be redded.** "A comment
  is a request; a red suite is a mechanism", and this round shipped four requests. UNPINNED and now
  pinned: the SWAP lane's `-f "$sf"` (deleting it measures **rc 124** — a wedged supervisor — with the
  whole suite green); `_tick_undecidable`'s rc-2 ALREADY-SAID arm (folding "stamp unreadable" into "no
  stamp" defeats the debounce through the fold instead of through the clear); the verdict's `ctrc` line;
  and `_pool_untaggable`'s registry-level refusal (without it an UNMEASURABLE box answers "untaggable",
  re-opening the constraint lift through the gate meant to bound it). Already pinned, measured rather
  than assumed: `_swap_target`'s project guard, the verdict's `hrc` and `prc` lines, and
  `_pool_untaggable`'s `-L` half.
- **D-2260 (2026-09-09)** — **three of this round's own new pins were vacuous until they were mutated,
  and that is the finding.** The pane-gate case (D-2256) passed under the mutation it names. The `ctrc`
  verdict case was green because `_swap_target` refuses on the same record and says `crosspool` from
  its own arm — the two lines only differ for a row inside `SWAP_COOLDOWN`, where the verdict runs
  ABOVE the gate and the `strc` arm never runs, so the fixture needed a fresh `lastswap` to measure
  anything. And the swap-lane `$sf` case never reached the read at all: `seedRow` sets home AND wrapper
  to the same account, so `_swap_target` takes its stay-put shortcut and the tick returns two hundred
  lines above it. **A pin is not written, it is measured** — all three were caught by running the
  mutation the case claims to catch, which is the only step that distinguishes a pin from a comment.
- **D-2261 (2026-09-09)** — **the count sweep, and a scanner's premise this round falsified.** The
  `_reg_get` census has now moved four times in four commits — 133 → 135 (the #70 merge's
  `_compact_note`) → 133 (round 4's two verb conversions) — and its line count was stated wrong twice
  by reusing the occurrence spelling, so both spellings are now written beside the numbers they
  produce. `_authdead`'s block gave ONE input set two cardinalities two lines apart. The cited anchor
  `grep -n 'mkdir -p "$POOLS_DIR"'` matched only its own citation, because the real call carries `--`.
  "`_auto_swap_check` calls `_strand_mark` TWICE on the same tick" is two call SITES, mutually
  exclusive, at most one firing. And "nothing matches the `<unmeasured>` literal (grepped)" was false in
  the same comment block that said it — a negative grep proves what was searched, never what was
  claimed. Separately, `ccd-arith-containment.test.ts` asserted its sites are "all `[[ … ]]` guards";
  D-2256 made one of them an `if [[ … ]]; then`, so the scan strips a leading `if ` — the assertion it
  actually makes (the digits guard precedes the arithmetic on the same line) never depended on the
  statement form, and widening the filter is honest where contorting the code back would not be.

### Mutation table — round 4

| # | mutation | measured |
|---|---|---|
| M14 | `_swap_target`'s project refusal back to rc 2 | RED — `the stamp names the project: expected '… crosspool' to contain 'project'` |
| M15 | the pool refusal back to rc 2 | RED — `expected '… the crossing record could …' to contain 'pool tag could not be read'` |
| M16 | the two surfaces decoupled again | RED ×3, incl. two pre-existing banner cases |
| M17 | `cmd_swap`'s guard reverted to `_reg_get` | RED ×5 — `fifo: the verb refuses` |
| M18 | `cmd_prefer`'s guard reverted | RED — the home was re-pinned out of pool |
| M19 | the `_pool_untaggable` gate dropped on the verb | RED — `the swap still happens: expected 1 to be +0` |
| M20 | the cooldown clear removed | RED — `the stamp must not survive the cooldown` |
| M21 | that clear un-gated from `$stuck` | RED — `episode two is said: … got 3` |
| M22 | the PANE gate given a clear too | RED — `a pane nobody could read decides nothing` |
| G3 | the SWAP lane's `-f "$sf"` deleted | RED — **rc 124**, a wedged supervisor |
| G4 | `_tick_undecidable`'s rc-2 arm deleted | RED — four ticks, four lines |
| G6 | the verdict's `ctrc` line deleted | RED — `expected 'null' to contain 'crosspool'` |
| G8 | `_pool_untaggable`'s registry refusal deleted | RED — `expected 'rc=0' to be 'rc=1'` |

---

## Deviations found — round 5 (the coordinator's round-4 gate)

The gate ran 7 lenses / 35 agents and asked for six things before clearing the merge; two of them —
a guard with no mechanism sitting next to a comment asserting the mechanism — it would not merge
without. **Both were re-measured here before anything was written, with the control that turns a green
mutation into a finding:** dropping `cmd_prefer`'s `! _pool_untaggable` left the whole ccd+pools set
green at 11 files / 354, and dropping the byte-identical text at `cmd_swap` redded
`but an UNTAGGABLE box still swaps` immediately. A green mutation on its own is ambiguous — unpinned
guard, unreachable line, or a mutation that never applied — and the control is what tells them apart.

- **D-2283 (2026-09-09)** — **the `swapblocked` cooldown clear was unpinned, two lines below a comment
  claiming it was pinned.** Round 4 shipped two clears and one measurement. `_swap_refuse` DELETES
  `.lastswap` and stamps `.swapblocked`, so after a refusal the swapblocked gate is the ONLY gate
  holding for the whole `SWAPBLOCK_COOLDOWN` — the unpinned half was the one carrying the refusal case,
  which is the case the pair exists for. Measured: replacing that clear with `:` left 11 files / 354
  green. Now RED, and the paragraph says which case pins which half instead of asserting both.
- **D-2284 (2026-09-09)** — **the same guard at two verbs, one measured and one not.** Every site that
  carries ` && ! _pool_untaggable` carries it identically. `cmd_prefer`'s was unpinned because the case that names `cmd_prefer` tags
  the pool, so `_pool_untaggable` is false there and the gate cannot change its verdict. The new case
  is `cmd_swap`'s, on a box with no `pools/` at all.
- **D-2285 (2026-09-09)** — **B3's third verb reader, and the gate's own finding corrected by half.**
  `cmd_start`/`cmd_enable` still read `.project` through `_reg_get`; an unreadable field folds to `""`,
  `_project_pool_state ""` answers `untagged` at its first line, and `untagged` permits everything — so
  the pool block decided "in pool" and said nothing. The gate says "both the die and the warn go
  silent".
  **The die is unreachable from that read:** it sits on the `-z "$regw"` arm, which is non-empty on
  every path that reaches this read (D-2317 retracts "creation-only" as the name for that test), and
  this read runs only on the id form, where an empty `regw` has already died at `no wrapper recorded
  for '$id' and none given`. What the fold silenced is the WARNING. The remedy is therefore a
  warning, for the same reason ruling 5 gives the mismatch one — a revival must not be refused for a
  placement the auto-swapper moves at the next idle boundary — and it carries `! _pool_untaggable`
  like the two dies.
- **D-2286 (2026-09-09)** — **"ONE MAPPING … cannot drift apart" was a claim written above the drift.**
  `_tick_strand_undecidable` built its own sentence, `"<word> could not be measured…"`, while the late
  path rendered the same condition through `_undecidable_cause`. Its two call sites are the tick's
  EARLY RETURNS, so one condition — an unreadable `.project` — produced two different `.stranded`
  sentences depending on which guard caught it, and the COMMON path was the one that named no file. It
  derives from `_undecidable_cause` now, which is what makes "cannot drift apart" a mechanism.
- **D-2287 (2026-09-09)** — **the fold needed a `wrapper` arm, and a fold that makes the sentence worse
  is not a fold.** `wrapper` is the word only the early return passes; without an arm of its own it
  would have landed in `*` and told the operator this build does not name a condition it names.
- **D-2288 (2026-09-09)** — **`_undecidable_cause`'s positional arguments were unpinned at the CALL
  SITE, and my first pin measured the arms instead.** Swapping `$2`/`$3` where the tick passes them
  renders `$POOLS_DIR/<row id>` and `$REG/<project>.project` — files that do not exist — on the exact
  surface round 4 added to stop that. 213 tests passed under that swap; so did the first cut of the new
  case, which drove `_undecidable_cause` directly with literal arguments and therefore measured the
  arms while claiming to measure the caller. **The mutation is what caught it, not the reading** — the
  same lesson as D-2260, one round later and on the fix for D-2260's own finding.
- **D-2289 (2026-09-09)** — **the `home` arm is reachable and had no test.** Reachable through
  `stuck=home`, never through `$strc` — `_swap_target` has no home rc — so removing the `hrc` arm from
  the caller's `case` was right and the sentence still had nothing measuring it.
- **D-2290 (2026-09-09)** — **a two-condition guard measured by a fixture that could not say which
  half caught it.** `_pool_untaggable`'s `[[ -d "$REG" && -x "$REG" ]]` fails for a non-directory AND
  for a directory nobody may enter. The fixture wrote a 0644 regular file, which fails `-x` as well as
  `-d`: measured, dropping `-d` left the whole set green. The file is 0755 now, so only `-d` can refuse
  it, and both halves red on their own mutation. Root-safe by construction — `-x` on a 0755 file is
  true at every uid.
- **D-2291 (2026-09-09)** — **a helper built for the other half and never called.** The same case
  constructed `runOn`, which `chmod 000`s the registry to measure the `-x` half, and then wrote
  `void runOn` instead of calling it. It is called now, guarded on `getuid() !== 0` for D-1997's
  reason: `chmod 000` is a no-op for root, so that half is measured wherever the suite is not root.
- **D-2292 (2026-09-09)** — **an assertion that passed under the collapse its own case forbids.**
  `expect(tickstuck).toContain('pool')` is satisfied by `crosspool` — the exact confusion the case
  exists to refuse. The field is `<epoch> <word>`; the word is what is compared now, at every site —
  **corrected at the refute pass**, which found the first cut had swept two of six (D-2321).
- **D-2293 (2026-09-09)** — **a test for a hang that could hang.** The compact-lane FIFO pin planted the
  same fixture as its sibling 50 lines up and drove it with a bare `h.sh`, with no `timeout`. Measured
  by the gate: deleting the guard produced no summary line after 600 s and two live
  `_auto_compact_check` processes, and the run had to be SIGKILLed. Bounded now — the same mutation
  reds both FIFO cases in **5.3 s**. The stubs go to a FILE rather than into the nested `bash -c`
  string, because they carry both quote characters.
- **D-2294 (2026-09-09)** — **D-2216 was closed with a comment, and this is its mechanism.** A marker
  check that passes is not a check that the file has ONE marker: `stripMarkerLine` removes only the
  line at `markerLineIndex`, so a second `# ccrc:generated` line sits INSIDE the hashed body and
  `verifyMarker` answers `ccrc-unmodified`. It happened twice in this PR's own history. **The count is
  on the PREFIX, not on `MARKER_RE`** — the line that actually shipped carried `PLACEHOLDER` where the
  digest goes, so a count of well-formed markers would have found exactly one and passed on the very
  file that carried the defect. Measured: replanting the shape and re-stamping gives `markers=2`,
  `verdict=ccrc-unmodified`, and reds exactly one case of fourteen — the new one.
- **D-2295 (2026-09-09)** — **`ccd/ccd` is the only file this can happen to, and that is measured, not
  assumed.** The recurrence mechanism is a merge conflict on the marker line — one whose BOTH sides
  edited `ccd`, corrected at the refute pass (D-2322) — which needs a generated
  file that is COMMITTED. `grep -rn '^# ccrc:generated' .` returns line 2 of `ccd/ccd` and two `docs/`
  lines quoting the format. `~/.ccrc/accounts.sh` and the wrappers are generated at deploy time from
  bodies that never contain the prefix and are never merged.
- **D-2296 (2026-09-09)** — **the `_reg_get` census: five statements of one number, four of them
  stale, and the stale ones first.** Delete the enumeration and point at the one place that owns it:
  the dated list in `ccd/ccd`'s `_reg_get` census block records each move with the ref it was measured
  at — no chain restated here. Round 4's own delta falsified it in
  four places while the block was byte-unchanged, which is how a number goes stale without anyone
  editing it. "Re-measure it" was a REQUEST; `ccd-reg-get-census.test.ts` is the MECHANISM, reading the
  sentence's own two numbers out of the file and comparing each to what the sentence says it counted —
  the shape `ccd-pool-ok.test.ts` has carried for the `_pool_ok` header through the same five rounds
  without going stale once. The four arguments above it now say "every call site"; a second case
  refuses a restated figure near the census (the band and the reason are in
  `ccd-reg-get-census.test.ts`'s own comment). One number, one place, one test.
- **D-2297 (2026-09-09)** — **the "corrected" `mkdir` anchor was still wrong, in both directions.**
  Round 4 replaced `grep -n 'mkdir -p "$POOLS_DIR"'` (one hit, its own citation — measured at
  `391b3e1f`) with `grep -n 'mkdir -p --'`, which
  returns FOUR: the `$POOLS_DIR` call, its own citation, and two `_LC_DIR` mkdirs that are not pools
  paths at all — a four-hit command offered as proof of a one-site claim. The anchor now names
  `$POOLS_DIR` and carries the `grep -vE '^[0-9]+:[[:space:]]*#'` filter this file already uses twice
  for the same trap.
- **D-2298 (2026-09-09)** — **the third present-tense claim about wave 3's reader, inside the round
  that removes them.** `_undecidable_cause`'s new header said `SessionRecord.stranded.reason` reaches
  "every ccrc surface" today; `git grep -c stranded server/src/registry.ts` is **0** on `origin/main`
  and on the PR branch (non-zero only on `ws/clear-meadow`, which is a different tree — `git grep -c
  stranded ws/clear-meadow -- server/src/registry.ts`). D-2201 removed this exact claim twice.
  Three more instances went with it: `_strand_mark`'s `STRANDED_UNREADABLE` — a constant
  `grep -rn 'STRANDED_UNREADABLE' --include='*.ts' .` finds nowhere in the tree — its `fleet.ts` ships
  that number clause, and the compact
  lane's `stranded.at` is shipped. All four are future tense now, and the fail-shut is stated as a
  REQUIREMENT this branch places on that reader rather than a measurement of one that exists.
- **D-2299 (2026-09-09)** — **an enumeration falsified by the entry added directly below it.**
  `pools-existence-pairing.test.ts`'s paragraph said "these eight functions and seven of them"; round 4
  added `_undecidable_cause` to `CCD_BLOCKS` in the same commit, making it nine and eight. The
  paragraph names the SET now — "every name in `CCD_BLOCKS` that contributes no entry to `CCD_SITES`" —
  because the lists ARE the census and a cardinal restated beside them can only drift.
- **D-2300 (2026-09-09)** — **D-2258's provenance clause attributed a pre-branch condition to this
  branch, inside the entry written to stop that.** It read "they are the round-2 constraint lift
  reaching the verb" about three `.project` shapes measured relocating silently on `origin/main` —
  which predates every commit here. The measurement was right; the provenance clause was not.
- **D-2301 (2026-09-09)** — **a hang-surface enumeration that overstated its own surface.**
  "`_compact_note` reads `compactskip`/`compactnote` on every tick the compactor DECLINES" is false for
  three decline arms: the kill-switch and the `lastcompact` cooldown return above the pane read, and
  the below-threshold arm calls `_compact_note_clear`, which reads neither field. The file's own D-2013
  comment says so twenty lines away. The paragraph exists to bound a hang surface honestly.
- **D-2302 (2026-09-09)** — **D-2162's grid was never recorded, and three mutually inconsistent
  designs have been written for one set of results.** `ccd/ccd` said "both cooldown states and six pane
  states" (12); the plan said "3 `lastcompact` × 4 `lastswap` × 6 pane" (72); every figure either
  states is "of 36". The RESULTS are internally coherent (18 + 18 − 6 = 30, remedy 3 gating on the swap
  cooldowns) and were measured — the DESIGN sentence was reconstructed afterwards, three times. It is
  **deleted rather than guessed a fourth time**, and both copies now say so. Nothing below it depends
  on the grid: the NO-FIX ruling rests on reachability, measured separately and re-measured
  independently at the gate.
- **D-2303 (2026-09-09)** — **"WHICH undecidable — READ, not inferred" is true only on the
  `$stuck`-empty path.** Whenever `hrc`/`ctrc`/`prc` answered 2 earlier in the tick, `uword` is still
  INFERRED — from measurements of earlier moments — and neither D-2254 nor D-2255 said so. Disclosed
  rather than closed: the tail is a STALE word, never a fabricated one (the condition it names WAS
  measured undecidable on that tick, which is the difference from the pre-#69 behaviour that named a
  `.crosspool` the fixture did not have), and closing it means the verdict and the refusal exchanging
  words, which no measured case asks for. **The gate also withdrew its own reviewer's "regression"
  reading here, and the withdrawal is right:** base `be16dbf3` stamped `crosspool` and then wrote a
  sentence from a different ladder unconditionally, so it named BOTH — which is D-2255 itself. Head is
  better than base in that fixture.

### Booked, not taken — each is its own PR, and a follow-up that is not numbered before the merge does not exist

- **D-2304 (2026-09-09)** — **`[pool=-]`: the one `_project_pool_state` consumer of eleven that folds.**
  Ruled by the coordinator to its own PR, and the reasoning is right: B3 earned its place here because
  it is a constraint LIFT, and this is a REPORTING defect — the placement is correct, only the sentence
  about it is wrong. Worse than filed: on the no-cause branch the banner contradicts itself in ONE
  sentence, because `_strand_why` already emits `tag:unreadable` into the same line; and `[pool=-]`
  reaches `swap.log` on both branches, where the first-mark debounce makes it permanent. The fix has a
  design in it — `_strand_mark` should derive from the same four words `_strand_why` already uses
  (`named <n>` | `untagged` | `unreadable` | `malformed`) rather than invent a second rendering — and
  the banner is asserted VERBATIM by `ccd-auto-swap-pool.test.ts`. Designs made at merge time ship wrong.
- **D-2305 (2026-09-09)** — **a `chmod 000` REGULAR session file reports the ABSENT sentence.** The
  compact lane's guard splits absent from non-regular; a third condition — a regular file that exists
  and cannot be opened — falls through `-f` to the grep, produces an empty `$st`, and emits
  `status-unreadable (no status in <path>)`. Three conditions, two sentences, in the block whose own
  comment says folding them "would be this program's own defect committed inside its own fix".
- **D-2306 (2026-09-09)** — **and the distinction that IS drawn never reaches the field.** Both
  conditions get the slug `status-unreadable` and differ only in the DETAIL, which
  `COMPACT_NOTE_FLOOR` suppresses after the first line and which never enters
  `$REG/<id>.compactskip` at all. #70's own rule 35 lines above forbids exactly that — "different
  SLUGS, not one slug with two details". Behavioural, in a lane #70 merged four hours before this
  branch touched it, so it wants its own PR and its own vocabulary decision. Related to D-2305; one
  fix closes both.
- **D-2307 (2026-09-09)** — **the pane gate can hold indefinitely, so a stamp can stick behind it.**
  B2's residual: four returns sit between the verdict and the clear, not two, and the pane one is not
  time-bounded. While it holds, a later genuine episode of the SAME field is never said. Mitigated in
  practice — the compact lane writes `compact-skip <id>: pane-blank` on the same tick — and the gate is
  deliberately the one that does NOT clear, so closing this is a design change, not a repair.
- **D-2308 (2026-09-09)** — **two live-fleet behaviours that reproduce identically on `origin/main`.**
  (a) An unmeasurable or de-rostered `.wrapper` makes the compact lane report
  `status-unreadable (no status in /sessions/<pid>.json)` — a filesystem-root path that does not exist
  — when the real condition is "this row's wrapper is not in the roster"; measured identical on
  `db580771`, `25a3cbb7`, `ee1d6228` and the PR head. (b) On ONE tick `ccd` dispatches an auto-rescue
  swap and types `/compact` into the same pane, because `lastswap` is stamped at DISPATCH and
  `_dispatch_swap` only launches a detached `sleep $jitter; ccd swap`. Neither is this PR's, both are
  worth their own numbers, and (b) tears down a compaction mid-flight on the one path this file treats
  as its most important behaviour.
- **D-2309 (2026-09-09)** — **three carries that are not about `ccd` at all.** (a) `ccrc-api.test.ts`
  throws an unhandled EPIPE under full-suite load and fails a REQUIRED check; pre-existing on `main`,
  and a one-line `child.stdin.on('error', …)` closes it. (b) `verifyMarker` still cannot see a
  duplicate marker, so D-2294's scan protects `ccd/ccd` in CI and nothing protects a file on a box —
  narrow by construction (deploy-time generators never produce the shape) but worth stating. (c) **A
  suite result is about a TREE, not a file.** Round 4 reported server 273/7397 for a PR whose head is
  277/7739: 273 is `ws/clear-meadow`'s count, and `ccd/ccd` being byte-identical between the two
  branches is necessary and not sufficient. Round 5's figures are measured on the PR head.

### Mutation table — round 5

Every guard this round shipped, mutated one at a time against the ccd+pools set — 11 files / 362 at
the head for M1–M11, `ownership.test.ts` (14 cases at the head) for M12, and `ccd-crosspool.test.ts` +
`ccd-reg-get-census.test.ts` (120 at the head) for M13–M17, which are about files that set does not
contain. Stated because the first cut of this table
quoted one set for rows measured on two (#69 review round 5, its own refute pass). The rows whose
pre-state is GREEN are the findings; the RED control on the byte-identical sibling is what makes
the first one a finding rather than "nothing covers this area".

| # | mutation | measured |
|---|---|---|
| M1 | the `swapblocked` clear replaced with `:` | GREEN 354 before → **RED** `the SWAPBLOCKED cooldown gate clears a stale stamp too` |
| M2 | `cmd_prefer`'s `! _pool_untaggable` dropped | GREEN 354 before → **RED** `and an UNTAGGABLE box still PREFERS` |
| M2c | the byte-identical text dropped at `cmd_swap` — the CONTROL | **RED** `but an UNTAGGABLE box still swaps` (already) |
| M3 | `cmd_start`'s read reverted to `_reg_get` | **RED** `cmd_start on the id form SAYS the project field could not be read` |
| M4 | `_tick_strand_undecidable` builds its own sentence again | **RED** at every case asserting a `.stranded` sentence — crosspool + auto-swap-pool, control green |
| M5 | the `wrapper` arm deleted from `_undecidable_cause` | **RED** at every case naming the account field — the fold lands in `*` — control green |
| M6 | `$2`/`$3` swapped at the call site | GREEN 213 before → **RED ×2** |
| M7 | the `home` arm deleted | **RED** `the home arm is reachable` |
| M8 | `-x "$REG"` dropped from `_pool_untaggable` | **RED** `it never licenses a guess` |
| M9 | `-d "$REG"` dropped | GREEN with the 0644 fixture → **RED** with 0755 |
| M11 | the compact lane's status guard deleted | 600 s no output + SIGKILL before → **RED in 5.3 s** |
| M12 | a second `# ccrc:generated` line replanted and re-stamped | `markers=2 verdict=ccrc-unmodified`, 13/13 green before → **RED**, 1 of 14 |
| M13 | the census sentence's stated number changed | **RED** — the first census case only; the second derives from that same sentence (D-2319) and tracks the change |
| M14 | a cardinal restated in the census block | **RED** `one number, one place` |
| M15 | the `wrapper` arm's verb reverted to "could not be read" | **RED ×4** — incl. the three-condition case |
| M16 | `_strand_mark`'s torn-epoch fallback deleted | GREEN before → **RED** `a TORN epoch … degrades to now` |
| M17 | `cmd_prefer`'s `.project` census set back to FOUR | GREEN before → **RED** `both numbers cmd_prefer claims` |

---

## Deviations found — round 5's own refute pass

Nine independent lenses were pointed at the round-5 commit with one instruction: kill it. **Seven
refuted.** Two of the fifteen findings below are guards this round claimed and did not measure; four are
false claims in comments this round wrote; three are claims falsified by *this round's own other
changes*; and one is a pin that punished its own remedy. The pattern is now measured six rounds running
and it is the reason the pass exists: **the fix introduces a defect at a seam adjacent to the one it
repairs**, and the only thing that has ever caught it is somebody trying to break it.

Two of the nine could not be killed: the `swapblocked` pin (D-2283) and the six test-quality pins
(D-2288–D-2293) survived every mutation aimed at them, including controls that deleted the *other* two
`_tick_decided` call sites to prove which clear the new case actually rides.

- **D-2312 (2026-09-09)** — **a self-counting anchor, in the paragraph that exists to stop one, 118
  lines from the entry correcting one at `47824849`.** The fold's new header offered
  `grep -n 'could not be computed' ccd/ccd` as "the census" proving every sentence producer routes
  through `_undecidable_cause`. It returns exactly ONE line — its own citation — because every arm ends
  "so no destination could **be** computed", never "could **not** be". Zero real hits for a claim about
  six. The census that measures is the CALL, not the sentence:
  `grep -n '_undecidable_cause "' ccd/ccd | grep -vE '^[0-9]+:[[:space:]]*#'`, which answers two.
  This is D-2297's own defect recommitted in the same commit, which is the finding.
- **D-2313 (2026-09-09)** — **and the claim it was offered to prove was too wide.** Two other
  `_strand_mark` call sites exist: the tick's no-target arm passes NO cause and lets `_strand_why`
  build the pool census, and `cmd_swap`'s auto arm writes its own refusal sentence. Neither is a
  drift — they answer different questions — but "EVERY SENTENCE PRODUCER GOES THROUGH HERE" says
  otherwise. Scoped to undecidable-condition sentences, with the two exceptions named.
- **D-2314 (2026-09-09)** — **the new `wrapper` arm asserted a read that did not happen.** Its caller
  fires on `[[ "$wrc" -ne 0 || -z "$wrapper" ]]` — unreadable, absent, AND read-successfully-empty —
  and the guard's own comment four lines up says why: "Read failure and read-nothing are different
  conditions with the same remedy here." The arm said "could not be **read**", which is true only of
  the directory fixture the shipped case planted. So the marker and the banner would have claimed a
  read failure while swap.log, on the same tick, still said the true thing. The verb is "could not be
  **measured**" now — what `_tick_undecidable` already writes — and a new case plants a ZERO-BYTE and
  an ABSENT `.wrapper`, the two conditions nothing could red.
- **D-2315 (2026-09-09)** — **`_strand_mark`'s torn-epoch fallback is a guard with no mechanism, and
  round 5 rewrote the paragraph asserting it without measuring it.** `[[ "$pat" =~ ^[0-9]+$ ]] ||
  pat="$now"` sits under a comment claiming "a torn stamp degrades to `$now` rather than writing a
  non-numeric field the wire would have to fail shut on". Deleting the fallback left the whole
  ccd+pools set green. **That is byte-for-byte the shape the round-4 gate refused to merge** — a guard
  with no mechanism next to a comment asserting the mechanism — introduced by the commit closing two
  others. Pinned now; the mutation reds one case.
- **D-2316 (2026-09-09)** — **round 5 falsified `cmd_prefer`'s `.project` census in the same commit
  that converted the reader.** That sentence said the cited command "answers FOUR — the two tick reads
  and these two verbs"; after D-2285 it answers FIVE across three verbs, and the bare grep six. The
  enumeration went stale one function away from the change that moved it, in the commit whose own
  message books D-2299 for exactly that. It is pinned now by a second case in
  `ccd-reg-get-census.test.ts` rather than restated — a request goes stale silently and a red suite
  does not. Its spelling is `grep -nF` because the pattern is a literal.
- **D-2317 (2026-09-09)** — **"CREATION-ONLY" is the wrong name for an overloaded-null test.** The
  correction to the gate's finding labelled the die's `-z "$regw"` arm creation-only. `regw` comes from
  `_reg_get`, so it is empty for a row whose `.wrapper` is absent, unreadable OR blank — the very fold
  this PR is about. The narrow claim survives and is what the comment says now: `regw` is non-empty on
  every path that reaches this read, so the die is unreachable from HERE. The pre-existing sentence
  three lines below, which called the same test creation-only, is corrected in the same edit rather
  than left sitting under its own correction.
- **D-2318 (2026-09-09)** — **and `.wrapper`'s own fold is B3's FOURTH verb reader.** `regw=$(_reg_get
  "$id" wrapper)` folds absent/unreadable/empty, and on an existing row an unreadable `.wrapper` today
  either refuses a revival with `pool-mismatch` or silently reverses "the registry wins" and rewrites
  the row to the argument's account. Pre-existing on `origin/main`, so its own PR — booked here because
  the round-5 comment cited that read as a correctness argument, which is the one thing it must not do.
- **D-2319 (2026-09-09)** — **a pin that punished its own remedy.** The census suite's second case
  hard-coded `toEqual(['132', '108'])`, so the SANCTIONED re-measure — add a call site, correct the
  sentence, which is exactly what the first case's failure message orders — left case 1 green and
  redded case 2 with advice that would have deleted the census. Both cases derive from the sentence now.
- **D-2320 (2026-09-09)** — **and its failure message claimed a range it did not have.** The cardinal
  scan matched `/\b1[0-9]{2}\b/` while claiming to refuse "any new three-digit cardinal": a restated 98
  or 260 sailed through. Widening to every 2–4 digit token is no better — the block legitimately
  contains `chmod 000` and "~20 supervisors". What is refused is now what the defect has always looked
  like: a figure within 25 of the census. A narrower claim that is true beats a wider one that is not.
- **D-2321 (2026-09-09)** — **the substring class was swept at two sites of six.** Four
  `.toContain('pool')` assertions on `.tickstuck` were left standing, each still satisfied by
  `crosspool`, and two of them sit in cases whose own titles are about naming the pool and not the
  crossing. D-2292's entry said "at both sites". Correcting the instance is not correcting the claim —
  which is this project's own rule, and the reason the sweep is a `grep`, not a memory.
- **D-2322 (2026-09-09)** — **"every merge of a ccd-touching branch conflicts exactly there" is
  false.** A merge where only ONE side edited `ccd` takes that side's line and merges clean; the
  conflict needs both. Measured. The overstatement sat inside the case whose whole subject is a claim
  that is stronger than its evidence.
- **D-2323 (2026-09-09)** — **and that case has a benign false positive worth naming rather than
  fixing.** A documentation comment quoting the marker format at column 0 reds it — which is the shape
  this repo's own spec doc uses twice. The assertion is right to fire (a line claiming provenance is a
  line claiming provenance), so the message now names all three causes and tells the author to indent
  the example by one space.
- **D-2324 (2026-09-09)** — **an assertion weakened without being booked, in a commit about assertions
  that pass for the wrong reason.** The fold changed `.stranded`, not swap.log, and
  `_tick_undecidable` still writes "project could not be measured" — so R3's
  `logLines('tick-undecidable')[0]` assertion did not need weakening to `.toContain('project')`, and it
  got it anyway with no comment and no number. Restored. Net coverage loss was zero because three
  sibling cases still pin that sentence, which is exactly why nothing caught it.
- **D-2325 (2026-09-09)** — **`grep -c` counts LINES, in the plan that supplies D-2201's evidence.**
  It read "`git grep -c stranded server/src/registry.ts` … **17** on `ws/clear-meadow`", prefixed
  "measured:". The cited command answers **12**; 17 is the case-INSENSITIVE count. Same family this PR
  books twice inside `ccd/ccd`, standing in the document that supplies the evidence for two of its own
  entries.
- **D-2326 (2026-09-09)** — **three smaller ones, each the same shape.** (a) The round-5 mutation table
  said every row was measured "against the ccd+pools set (11 files / 362)", while M13–M17 were measured
  on a file that set does not contain; the preamble now says which rows used which set. (b)
  `pools-existence-pairing.test.ts`'s corrected paragraph wrote "all but two", a restated cardinal two
  lines after the sentence forbidding one. (c) `ccd/ccd` cited `server/src/server.ts:1305` for a regex
  that is at 1306 on both refs — replaced with the anchor this file's own convention requires.

---

## Deviations found — round 5's merge gate (the last two, and the ruling that stops the loop)

- **D-2339 (2026-09-09)** — **a tautological assertion, in the commit whose subject is assertions that
  pass for the wrong reason.** `ccd-reg-get-census.test.ts` closed with
  `expect(bare - filtered, '<message>').toBe(bare - filtered)` — a value compared to itself. It cannot
  red on any tree, and its message named a check it did not perform. Proved both ways by the gate: `+ 1`
  on the right-hand side reds, so the line executes; a content mutation moving the real delta 1 → 2
  leaves it green. The property it named is not independently checkable either — `bare - filtered` IS
  the comment-line count by construction, and the two assertions above already pin each stated number to
  reality, so their difference follows. What is NOT derivable is that anything quotes the pattern at
  all: strip the citation out of `cmd_prefer`'s comment and both assertions track the new pair while the
  prose goes on explaining a self-count that no longer happens. That is what the line asserts now.
- **D-2340 (2026-09-09)** — **a prose regression built on an inherited measurement.** Round 5 rewrote
  the `mkdir` anchor's history to say round 3's `mkdir -p "$POOLS_DIR"` spelling "matched nothing at
  all … zero hits". Round 4's wording — "matched only its own citation" — was correct: measured with
  GNU grep at `391b3e1f` and at `be16dbf3`, that spelling returns **1**, the comment quoting it. The
  zero came from a round-4 review artifact rather than from a re-measurement, and that artifact's shell
  resolves `grep` to a shim that mishandles a literal `$` mid-pattern. The sentence also self-refuted on
  the shipped tree, because re-quoting the spelling is itself a match. Two lessons, and the second is
  the one worth carrying: **a measurement quoted from a review is a claim, not a fact** — the same rule
  this plan applies to every other number, applied to the numbers that arrive in findings.
- **D-2341 (2026-09-09)** — **the citation sweep is its own PR, against a frozen tree, with nothing else
  in the commit.** The gate's ruling and its measurement: round 4 found 6 defects, round 5 closed them
  and its own refute pass found, inside the commit that closed them, the entries booked as
  D-2312–D-2326 (`## Deviations found — round 5's own refute pass`), and the merge gate found ~12
  inside the commit that closed those — zero behavioural, zero touching a guard, eleven of them
  citations, most introduced or left standing by the commit whose purpose was sweeping that class.
  **Each round fixes citations at about the rate it creates them.** The delta's own proportions say why:
  272 lines of `ccd/ccd` against 340 of plan, so the prose is now larger and more fragile than the code,
  and every count in it is a claim about a tree the next commit moves. **A citation swept in the same
  commit as other work is stale before the commit lands.** Known open and deliberately NOT fixed here:
  "four sites carry the gate" where the same commit made it five; "133 at C1" left in the new suite's
  header after the delta corrected it to 134 in `ccd/ccd`; "17 on `ws/clear-meadow`" corrected at one
  site of three, the two survivors being `ccd/ccd`'s wave-3 sentence and D-2298's parenthetical
  (`grep -n '17 on' ccd/ccd docs/superpowers/plans/2026-09-08-c1-rescue-lane-followup.md`); the
  M13/M4/M5 rows falsified by this commit's own changes; `cmd_start`'s "the paragraph
  below calls it" where that paragraph was corrected in the SAME commit to say the opposite; "ONE of its
  five sentences" now six; and "creation-only" left standing at both remaining sites —
  `server/test/ccd-crosspool.test.ts` and D-2285's own entry above — after D-2317 retracts it.

---

## Deviations found — the #73 merge, and the refute pass on its resolution

`main` moved under the PR: `e227329e` (#73) landed and touched `ccd/ccd`, so #69 went CONFLICTING. The
conflict was **exactly one line** — the provenance marker — which is the recurrence D-2294 was written
for, arriving in the first merge after the pin that catches it. Resolved by dropping BOTH markers
with the
conflict block and re-running `markGenerated`; D-2216 is what the other resolution looks like.

**The `_reg_get` census pin fired on the raw merge, by itself, on a change from outside this PR.** #73
adds one `_reg_get "` call, and the suite failed with "ccd/ccd now makes 133 … calls, but the census
still claims 132. Re-measure the sentence, do not re-measure this test." A citation on this branch went false
in the seconds it took an unrelated PR to land, and the only reason anyone knows is that one number had
a mechanism. That is the case for a pin over a sweep, and it is now written into the block itself.

Three lenses were then pointed at the resolution. The first could not kill it — measured by rebuilding
the mechanical three-way merge of all 23 touched files and diffing against the commit: 21 byte-identical
to the union, `ccd/ccd`'s only non-mechanical hunk the disclosed census prose, 237 function definitions
and 237 distinct, zero lines lost from either parent, no conflict residue. The other two found this.

- **D-2343 (2026-09-10)** — **the history clause was rewritten false, in the paragraph celebrating the
  pin.** Three claims, all measured wrong. "It has moved five times" — it has moved **six**. The
  enumeration was mis-ORDERED: round 3 (`391b3e1f`) is an ancestor of the #70 merge (`1714038a`), so the
  drop to 133 came FIRST and the merge pushed it back to 135, not the reverse. And "#73 … THE FIRST MOVE
  NOBODY HERE MADE" is false — the #70 merge already moved it 133 → 135 from `main`'s compactor sites,
  which this same block already names as having landed `_reg_get` sites from `main`. The half the
  commit actually earned is narrower and is
  what it says now: **#73 is the first move the PIN CAUGHT**, because it is the first that happened
  after the pin existed. Two of six moves came from outside, which makes the argument stronger, not
  weaker.
- **D-2344 (2026-09-10)** — **a correction with the polarity backwards, inherited from round 5's own
  refute pass.** That pass corrected "133 at C1" to 134 and added a cause: "133 is what C1's own
  sentence claimed, so the figure was inherited rather than measured". Measured: `db580771:1611` says
  **134**, and 134 is the true count at that ref. C1 measured correctly; what inherited a wrong 133 was
  this branch's own prose. A parenthetical written to close a misattribution, misattributing.
- **D-2345 (2026-09-10)** — **the excluded span is the one unread place in the block, and every false
  claim landed there.** The pin's cardinal scan reads everything up to the dated list and nothing
  inside it; the merge commit moved the end anchor forward by 128 characters and those characters are
  exactly the new false sentence. Structural fix rather than another correction: the pin's ARGUMENT
  moved ABOVE the anchor, where the scan reaches it; the rule for the list itself — a bare measured
  figure with the ref it was measured at, nothing that argues — is stated there and is not yet met by
  the `db580771` and `1714038a` entries.
- **D-2346 (2026-09-10)** — **an ordinal is a restated census wearing a suffix.** The scan matched
  `\d{2,4}\b` and so could not see `the 132nd call site`; the refute pass planted one and it passed.
  Widened to `\d{2,4}(?:st|nd|rd|th)?` — and it immediately found a live one this branch had carried
  since round 2 (`74a50164`, the round that booked D-2155–D-2162),
  `"the 135th is the one C1's own _tick_strand_undecidable added"`, now gone by the
  block's own delete-or-point rule. Word-spelled figures remain a hole and are DISCLOSED rather than
  papered over: the other census in this file spells its numbers as words, which is exactly why nothing
  ever caught THAT one going stale, and a word-matcher here would be a second vocabulary to keep in
  step. The third case pins that census by its words instead.
- **D-2347 (2026-09-10)** — **an unguarded read-by-name arrives from #73, one function from the rung
  #69 exists to establish. Its own PR.** `_transcript_stalled_pair` tests `[[ -r "$f" ]]` and then reads
  `$f` by name; `-r` is true for a FIFO and for an unbounded character device, so that read blocks in
  `open(2)`/`read(2)` for ever. It is the identical class this PR's round 3 closed for `_reg_get`,
  `_auto_swap_check`'s `$sf` and `_auto_compact_check`'s `$sf`, and its caller sits on a worse path:
  `_redrive_after_spawn` runs from `_spawn_settle`, which `cmd_supervise` reaches BEFORE its watch loop,
  on every spawn, swap landing and restart. **INHERITED, not introduced** — byte-identical on
  `origin/main` — so it is not this resolution's defect, and it is not fixed at merge time either: the
  remedy is one line (`[[ -f "$f" && -r "$f" ]]`) plus the red-first FIFO case `ccd-redrive.test.ts`
  has no equivalent of.
  **CORRECTED — this entry claimed the one-liner was "behaviour-identical for every input that answers
  today", and that is false.** Measured by extracting the function verbatim and driving it under
  `timeout 5` on both spellings: a FIFO and a symlink to `/dev/zero` go HANG -> 2, a real transcript
  stays 1, an absent path stays 2, and **a DIRECTORY moves 1 -> 2**. So it is a behavioural change, not
  merely a hang fix. It is a CORRECTING one — `tail` on a directory emits nothing, so the loop reports
  "measured, not a stall" about a window it never read — but a claim of identity was wrong, and the
  clause was written from the shape of the guard rather than from running it. The coordinator's
  independent census over `ccd/ccd` found the same row, and books it in the ccd queue plan — its
  number is NOT named here, because a D-ref in tracked prose seeds this project's ledger floor
  whether or not the number was issued to this plan, and `deviation-refs.test.ts` refuses it. A one-line behavioural change to
  another PR's code, made at merge time, is what "designs made at merge time ship wrong" is about.
  **A refutation is a claim, and half of this one did not survive:** the lens also reported that #69's
  comment "claims that rung as shared". It does not — it names one specific sibling lane,
  "`_auto_compact_check` carries the same rung over the same path and a DIFFERENT arm", and that
  sentence is still true. No edit there.
- **D-2348 (2026-09-10)** — **a diff hunk header is a guess the TOOL generates; the funcname driver that
  looks like the fix makes it worse; and what does fix it has no reach. Booked by the coordinator,
  measured here, REWRITTEN after three lenses refuted the first draft, and not taken.**
  **The mechanism.** `git`'s `@@ … <text>` is the nearest line matching the funcname pattern **strictly
  ABOVE the hunk's first line** — context included, so a match sitting AT the hunk start is never
  eligible — and the search runs **in the PREIMAGE**, not in the new file. *The preimage half is the
  structural fact and earns its own sentence: a function the commit ADDS is not in the search space at
  all, so no `xfuncname` can ever name it.* Measured at git 2.43.0 — rename `_oldname` to `_newname` and
  edit inside it in one commit, and the header still reads `@@ -5,2 +5,3 @@ _oldname() {`, naming a
  function absent from the new file.
  **The first draft of this entry stated that rule as "at or above the hunk start", and its own headline
  example refutes it:** old `ccd/ccd:13557` IS `_inject_spawn_effort() {` AND IS the hunk start of
  `@@ -13557,6 +13611,9 @@ _spawn()`. Under the rule as first written, git would have labelled that
  hunk `_inject_spawn_effort` and the case could not exist. A doctrine entry whose mechanism sentence is
  falsified by the evidence it cites — found by refuting the entry, never by writing it.
  **The census** (`git diff e227329e^1 e227329e -- ccd/ccd`, 12 hunks at the default `-U3`): **four
  headers name a function that does not contain the change** — `_swap_target` for the new
  `_pane_auto_continue_armed`, `_tmux_new_session` for the new `_resume_env`, `_inject_spawn_effort` for
  the three new `_transcript_stalled_pair` / `_redrive_standdown_log` / `_redrive_after_spawn`, and
  `_spawn` for a change inside `_inject_spawn_effort`. A fifth header is EMPTY — the `ccrc:generated`
  marker is line 2 and that hunk starts at line 1, outside every function — and a sixth names a variable
  assignment four lines above its own change, `SUBSTRATE_BACKOFF_AFTER=3`, which is the plainest evidence
  that the default heuristic is not a function parser at all. **The first draft said "6 of 12 do not name
  where the change is": arithmetic standing in for a claim, since an empty header misleads nobody and a
  coarse anchor is not a misattribution.**
  **Two mechanisms, not one, and only one of them is beyond a flag.** Three of the four are
  append-after-close — a new function inserted after its neighbour's closing brace, wrong at every
  context width. The fourth is not: that change sits three lines below `_inject_spawn_effort`'s own
  definition line, so the default three lines of LEADING CONTEXT put the hunk start at that definition
  and push the search above it. Measured at every width — `-U0`, `-U1` and `-U2` all label it
  `_inject_spawn_effort()`, CORRECTLY, and only `-U3` makes it `_spawn()`. The first draft called this
  the sharpest case and folded it into the unreachable class; it is the one instance a flag does reach.
  **The obvious remedy makes it worse, and this was measured on the corpus rather than on a fixture.**
  This repo has no `.gitattributes` and no `diff.*` driver — `git check-attr diff -- ccd/ccd` answers
  `unspecified` — so every file here uses the built-in heuristic. Reconstructing #73's diff in a scratch
  repo (headers byte-identical to the live diff) and planting `* diff=bash` does NOT reproduce the same
  labels: hunk 2's truthful-but-uninformative `SUBSTRATE_BACKOFF_AFTER=3` becomes `_svc_run_detached()`,
  a function that opens at 742 and closes at 756 — some 193 lines above the change at 949.
  **Misattributions 4 -> 5 of 12.** A custom `xfuncname` cannot help either: the search SPACE is what is
  wrong, not the pattern.
  **What DOES work has no reach, and that is the real reason this is doctrine rather than a config
  change.** An external differ wired as `diff.<name>.command` — configured exactly like a funcname
  driver, `.gitattributes` plus `git config` and nothing else — relabels both failing shapes correctly.
  The first draft claimed "no configuration reaches this class"; that is false. The reason to go on
  reading hunk bodies is REACH: an external differ is a program every reader must have installed, and
  GitHub's PR view, the PWA's diff surface and any plain `git show` on another box honour none of it.
  **A hunk header is never evidence about what changed** — read the hunk body, or ask the file
  (`git log -L :<fn>:<file>`).
  **Why it sits beside D-2340's ugrep zero.** Both are false anchors generated by the TOOL, so **no care
  by the AUTHOR OF THE CHANGE prevents it — only care by the READER does.** (The first draft wrote "no
  amount of author care", which collides with D-2340, whose whole lesson is that re-measuring IS the
  remedy.) The shape that makes it fire here is not exotic: at `e227329e`, `ccd/ccd` carried 234 function
  definitions and EVERY ONE was at column zero, 204 of them closed by a column-zero `}` and the rest
  one-line forms — so "add a helper beside its peers" is the dominant change shape, and append-after-close
  is the common case rather than the corner one. **The exposure is already present in this program:**
  D-2347's unguarded read-by-name sits under the `_inject_spawn_effort` header, one of the four — and
  D-2347 named the right function only because the finding read the hunk body. Nothing was mis-read, so
  this is exposure, not a cost already paid; the first draft claimed the latter.
