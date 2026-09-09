# C1 follow-up — the guards straddled the rescue lane (#67 review)

**Base:** `origin/main` `db580771` (#67, C1). Branch `ws/clear-meadow`.
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
inode and C1 is EXECUTING on the box, not merely installed. That distinction is the one `:14876` was
rewritten to make (D-2034), and it is the criterion D-1999 states — so the embargo is genuinely lifted,
by the refined criterion rather than the loose one.

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

**Deviations DEFINED here:** D-2026–D-2035 (floor to 2036). Every number below is defined here and
nowhere else.

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
- The `.project` fold (D-2000, defined in the C1 plan; widened as D-2009, whose entry is in
  `docs/superpowers/plans/2026-09-05-account-pools-wave3-server.md`, not in the C1 plan) is a wave-3
  DEPLOY PREREQUISITE by the coordinator's re-ruling, to be taken as its own small `ccd` PR.
  Spelled that way on the #69 review's advice so it needs no second correction: it names the wrong
  home it is retracting, and it is true before and after wave 3 merges.
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
- **D-2162 (2026-09-09)** — **one finding killed by reproducing it, and this is the entry that earns
  the round.** The report said `_tick_strand_undecidable`'s unconditional `tmux capture-pane` sits
  above both cooldown gates and adds an un-debounced fork every five seconds. Every mechanical claim is
  TRUE and the severity claim is FALSE, because both the reviewer and my first verifier measured
  `_auto_swap_check` in isolation while the supervise loop drives four things per tick:
  `_auto_compact_check` ALREADY captures the pane unconditionally on exactly such a row, since its
  `lastcompact`/`lastswap` gates read empty precisely because that row's registry is the unreadable
  thing. So the lane does not add a capture to a row that had none — it doubles one already there,
  10 → 20 per ten ticks, not 0 → 10. **And both proposed remedies measured as defects**: gating on
  `.tickstuck` shuts the gate from tick 2 and reproduces `main`'s silence exactly for the
  undecidable-then-blocked case the function exists to catch; hoisting the call below the cooldown
  gates is unreachable from the branch it serves. NO FIX. Recorded because a finding that survives 38
  refute passes and dies on the 39th is the argument for the 39th.

### Corrections carried in the same round, without their own numbers

The `_reg_get` census said 134 and its own command now yields **135** — the 135th is the call C1's
`_tick_strand_undecidable` added, in the paragraph rewritten to correct a count. `svcfailed` is a 34th
registry field and joins the inventory. The `_pool_ok` header moves 18/11 → 19/11 (prose only; the
call-site half has never moved). The navigation note saying "do not go looking for a literal `-eq 2`
branch inside `_auto_swap_check`; there is none" was falsified by C1 in the commit that left it
standing, and by this round again. `_swap_target`'s contract line declared two exit codes for a
function that returns three. And this plan's own claim that `server/src/pools.ts` "does not exist on
`main`" is false — the FILE is on main; the LINE the scanner trips on is not.
