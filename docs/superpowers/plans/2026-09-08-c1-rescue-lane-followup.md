# C1 follow-up — the guards straddled the rescue lane (#67 review)

**Base:** `origin/main` `db580771` (#67, C1). Branch `ws/clear-meadow`.
**Why this exists:** the coordinator's review of #67 finished AFTER the merge and found six survivors,
one of which is a REGRESSION now on `main`. The operator ruled to HOLD the agent deploy until this
lands, so the fleet is still on the pre-C1 inode and nothing has shipped either defect.

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
- The `.project` fold (defined in the C1 plan as D-2000, widened there as D-2009 — referenced here,
  defined nowhere but there) is now a wave-3 DEPLOY PREREQUISITE by the coordinator's re-ruling, to be
  taken as its own small `ccd` PR.
- The `it.skipIf` suite still degrades silently under root. Taken as a mechanism in its own change,
  not folded here: it touches every skipped case in the file and this one must stay small.
