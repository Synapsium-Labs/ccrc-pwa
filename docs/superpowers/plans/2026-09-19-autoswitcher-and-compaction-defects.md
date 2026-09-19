# Three supervise-tick defects — the manual-swap pin, the current-wording limit banner, and the no-turn compaction guard

**Goal:** Close three defects the operator reported on 2026-09-19, all of them in `ccd`'s five-second
supervise tick, all of them measured on the live fleet before anything was changed:

1. **A manual swap does not stick.** Switching a session to another account by hand is reversed by the
   affinity arm at the first tick past `SWAP_COOLDOWN` — fifteen minutes, which is what "it switched
   back straight away" measures to.
2. **A limited session is not auto-swapped and waits for a human.** The pane classifier's alternation
   predates Claude Code's current banner wording and matches none of the three commonest limit
   banners, so the rescue depends entirely on the cached, newest-row-only, draft-deferring transcript
   fallback D-2363 added as a *second* detector.
3. **An idle session is compacted over and over.** The compactor decides on a cooldown and a context
   percentage and asks nothing about whether the conversation changed, so a session whose
   post-compaction floor sits at or above its threshold re-compacts every `COMPACT_COOLDOWN` for
   ever — summarising a summary and throwing away real context each time.

**Architecture:** `ccd/ccd` only. Three independent slices on one branch, no new verbs, no wire change,
no server or PWA change. Slice 1 adds a registry marker (`$REG/<id>.swappin`) and two predicates
around it. Slice 2 adds one pane predicate with a single caller and threads the verdict's provenance
through a well-known variable instead of re-asking a classifier. Slice 3 adds one transcript reader
and one fail-open gate at the bottom of the compactor.

**Tech Stack:** bash 5.2 (`set -uo pipefail`), python3 for the two transcript scans, vitest for the
suites. `ccd/ccd` is a committed generated file — re-stamp with `shared/mark.mjs`'s `markGenerated`
after every edit or `ownership.test.ts` reds.

**Measured against** this worktree at `origin/main` = `083aeb10`, and against the live fleet host's
`~/.cc-sessions/swap.log`, registry and wrapper HOMEs on 2026-09-19.

## What was measured, before anything was changed

**Slice 1 — the manual swap.** `cmd_swap` moves `wrapper` and never touches `home`, and
`_auto_swap_check`'s affinity arm exists to "return home the instant home has room again". One
session, one afternoon, from `swap.log`:

```
14:30:22 swap      <row>: <home-lane> -> gpt   (the operator)
15:25:47 auto-home <row>: gpt -> <home-lane>   (the tick)
15:36:54 swap      <row>: <home-lane> -> gpt   (the operator, again)
15:51:56 auto-home <row>: gpt -> <home-lane>   (15m 02s later — one tick past SWAP_COOLDOWN)
16:28:53 swap      <row>: <home-lane> -> gpt   (the operator, a third time)
17:01:11 auto-home <row>: gpt -> <home-lane>
```

`ccd prefer` is the verb that moves `home`, and its own header records that it is shell-only: no
exec-whitelist entry, no `CCD_ARGV` builder. An operator on a phone therefore had **no way at all** to
make a swap stick.

**Slice 2 — the banner.** Read off every `isApiErrorMessage` row on disk across the fleet's wrapper
HOMEs, these are the texts Claude Code actually renders, against `_pane_hard_blocked`'s alternation:

| banner | old pane arm |
|---|---|
| `You've hit your session limit · resets 9:10pm (UTC)` | **no match** |
| `You've hit your weekly limit · resets Sep 21, 7am (UTC)` | **no match** |
| `You've hit your limit · resets Sep 17, 9pm (UTC)` | **no match** |
| `You've hit your monthly spend limit · raise it at …` | matches (`monthly spend limit`) |

The fleet log agrees: the one rescue of this shape on 2026-09-19 is logged ` … via=transcript`, i.e.
the pane arm answered "not blocked" about a pane that was displaying the answer. Claude Code also
AUTO-OPENS its `/rate-limit-options` dialog on a limit (a `local-jsx` command submitted on the
session's behalf), which is the interactive prompt the operator described having to answer by hand.

**Slice 3 — the compaction loop.** Of 622 `auto-compact` lines in `swap.log`, **163 came within 40
minutes of the previous compaction of the same session, and all 163 read the IDENTICAL `ctx%` as the
line before them.** One workspace took 25 consecutive compactions at exactly 1800-second spacing,
every one reading `ctx 51%`, from 20:39 on 2026-09-10 to 08:40 the next morning. An identical
percentage is the signature: nothing had changed, and compacting changed nothing.

## What shipped

| File | Action | Responsibility |
|---|---|---|
| `ccd/ccd` | modify | `_swap_pin_tick`, `_swap_pinned`, the pin's write in `cmd_swap` and its clear in `cmd_prefer`, the affinity stand-down; `_pane_limit_banner` and the `HARD_BLOCK_VIA` provenance; `COMPACT_TURN_TAIL_LINES`, `_transcript_last_turn_ts`, `_compact_no_turns` and the compactor's last gate. |
| `server/test/ccd-swap-pin.test.ts` | add | The pin: 13 cases, 10 measured mutation rows. |
| `server/test/ccd-limit-banner.test.ts` | modify | The banner family and the provenance word: 20 cases, 5 measured mutation rows. |
| `server/test/ccd-auto-compact.test.ts` | modify | The no-turn guard and the turn reader: 17 cases, 6 measured mutation rows. |
| `server/test/ccd-arith-containment.test.ts` | modify | One `SITES` row and two payload cases for `_compact_no_turns`' two operands. |

**The three rulings that shaped the code, stated because none of them is visible in a diff:**

- **The pin is not a re-home** (operator ruling, 2026-09-19). Rewriting `.home` would also make the
  session return to that account after every future rescue and would destroy the home it had. The pin
  names the account a human chose, stands the affinity arm down while the row is still on it, and ends
  by MEASUREMENT (`_swap_pin_tick`) rather than by a clock. It has no epoch, so nothing about it can
  expire or reach arithmetic.
- **The rescue arm is never gated by the pin.** A pin is a preference about a HEALTHY session's
  placement, never a reason to leave a limited one wedged. The check sits between the rescue dispatch
  and the hold file, and a source pin holds that ordering.
- **D-2364 is kept, not reversed.** It ruled that `_pane_hard_blocked` is not widened, because
  `_spawn_settle` turns that same regex into rc 5 on every landing and whether Claude Code re-renders
  the previous assistant message on a `--resume` landing is unmeasured. That function is untouched; the
  new wording lives in its own predicate with one caller, and the suite pins the old arm's answer for
  each measured banner **in both directions**.

## Deviations found

Numbers here are ISSUED (`ccrc-api ledger allocate`), never taken from a floor. Each is a design
decision this branch made and its shipped source cites.

- **D-3097 — the manual-swap pin: `$REG/<id>.swappin`.** What departed: nothing in the tree let an
  operator's `ccd swap` survive the affinity arm, and the one verb that could (`ccd prefer`) is
  shell-only by its own header, so a PWA tap could not reach it. Why the marker rather than a re-home:
  the operator ruled that a manual swap pins the row where it is and leaves `home` alone, so ordinary
  affinity resumes the moment anything else moves the row. What shipped: a one-token file naming the
  chosen account, written by `cmd_swap` on the operator path, read by `_swap_pinned`, and consulted by
  `_auto_swap_check` immediately above the hold file — below the rescue dispatch, so a limited pinned
  session is still evacuated. No epoch, so no expiry and no arithmetic operand. `_reg_purge`'s
  `"$REG/$id".*` glob already collects it with the row.
- **D-3098 — the stand-down is SAID, floored on the row's own anchor.** What departed: every other
  §6.3-class stand-down in this file speaks, and a silent one would leave an operator watching a
  session that simply never returns home with nothing anywhere saying why. Why floored: the check runs
  every five seconds per session against a `swap.log` a human reads — `_compact_note`'s own
  measurement. What shipped: one `pin-hold` line per session per `ROUTE_NOTE_FLOOR`, through the
  existing `_route_note_floored` helper (reused rather than re-spelled, so its D-299 digit guard is
  not copied unpinned) with the anchor in the row's own `swappinnote` field.
- **D-3099 — the pin follows the truth, and an explicit `prefer` supersedes it.** What departed: a
  marker naming an account the row has left is a claim about the present that is no longer true, and a
  pin left standing beside a hand-set `home` would give one session two answers to the same question —
  the pin's would win, silently suppressing the return-home the operator just asked for. What shipped:
  `_swap_pin_tick`, called at the first line of the tick where `wrapper` has been MEASURED, ends a pin
  that names another account and clears its note anchor with it (so a fresh pin speaks straight away
  rather than inheriting the old one's floor); `cmd_swap`'s automatic arm and `cmd_prefer` both clear
  it immediately. An UNREADABLE pin is neither deleted (`_crosspool_tick`'s lesson: no destructive act
  on a read that failed) nor ignored — doubt reads as PINNED, which is the rule the hold file two lines
  below already follows.
- **D-3100 — `_pane_limit_banner`, a second pane rung for this year's wording.** What departed: the
  pane arm — the primary, every-tick, uncached detector — matched none of the three commonest live
  banners, so the rescue of a limited session rested on a fallback that is cached for
  `TRANSCRIPT_ARM_INTERVAL`, requires the banner to still be the newest real row, and stands down
  entirely over a human's draft. Why a new function rather than a wider regex: D-2364 ruled the old
  alternation is not widened because `_spawn_settle` turns it into rc 5 on every landing; that ruling
  is kept and its function is untouched. What shipped: `grep -qiE "hit your ([a-z0-9]+ )*limit ·"`,
  called only by `_session_hard_blocked`, between the old pane arm and the transcript arm. The `·`
  separator is part of the pattern so an assistant SAYING the words cannot swap its own session out,
  and a wording change that drops it fails CLOSED — today's behaviour, `_pane_limit_stale`'s own rule.
  The known cost, stated rather than overlooked: this is a pane rung, so it shares the shipped contract
  that a visible banner swaps DRAFT OR NOT; giving one condition two behaviours depending on which
  equally-visible banner the build renders would be worse.
- **D-3101 — `HARD_BLOCK_VIA`: the rescue line names the detector that fired.** What departed: the
  `auto-rescue` line re-asked `_pane_hard_blocked` to decide whether to write ` via=transcript`, which
  was sound only while `_session_hard_blocked` had exactly two rungs and one of them WAS that call.
  With a third rung a re-asked classifier answers "not the pane" about a verdict the pane produced, and
  the log would say `via=transcript` about a banner that was on screen. What shipped: the predicate
  stamps `pane`, `banner` or `transcript` on each success and clears it on every path that answers no;
  the log line reads it. `pane` stays silent, so every line already in the fleet's log keeps its exact
  shape. A global rather than a second stdout token, for the reason `KS_WHY`/`PROBE_VERDICT` are: this
  is a predicate, and a `$( )` call site would lose a well-known variable to the subshell.
- **D-3102 — `_transcript_last_turn_ts`: the newest REAL turn, compaction rows excluded.** What
  departed: `_transcript_limit_banner`'s chatter rule skips the three local-command prefixes, and that
  rule was written for "did the session move on after a banner", where a compaction cannot have
  intervened. Asked ACROSS a compaction it is not enough. Measured on a live transcript: one `/compact`
  appends four `type:"user"` rows — the `isCompactSummary` summary, stamped roughly four minutes AFTER
  ccd typed the keys, plus the caveat, the command and its stdout. The last three are the existing
  chatter prefixes; the first is not, and it carries a timestamp later than `lastcompact`, so a reader
  that counted it would see "a turn happened" on every compacted session and D-3103 would never fire
  once. What shipped: a reader that skips `isCompactSummary` and `isMeta` rows as well as the three
  prefixes, takes the NEWEST surviving row's epoch (nothing resets it — this asks "when did anything
  real last happen", not "is X still the last word"), and answers rc 1 for a window with no real turn
  and rc 2 for a transcript it cannot read. A malformed timestamp is skipped, so it can only make the
  answer OLDER — fail open at the caller, never newer.
- **D-3103 — the no-turn compaction guard, fail open.** What departed: `_auto_compact_check` decided
  on the `lastcompact` cooldown and `ctx%` against the threshold, and neither is a fact about whether
  the conversation changed. What shipped: `_compact_no_turns`, the compactor's LAST gate — after every
  cheaper test, because it resolves a transcript path and scans it through python, the read D-2444
  measured at an order of magnitude over the pane classifier. It answers 0 only on a POSITIVE
  measurement that nothing happened; no `lastcompact`, an unresolvable or unreadable transcript, a
  window with no real turn, or python absent all answer 1 and the compactor behaves exactly as before.
  A guard that silenced the compactor on a transcript it could not read would trade a wasteful
  compaction for a session that never compacts at all — the #67 R1 shape `_auto_swap_check`'s own
  header forbids. The refusal is its own reason (`no-turns-since-compact`), never `post-swap`'s: those
  two say different things and have different remedies. The epoch comparison is `-le`, not `-lt`,
  because `lastcompact` is stamped the instant before the send-keys and a turn in the same second is
  indistinguishable from the compaction's own at one-second resolution; equal reads as "nothing since"
  and the next tick re-measures.
- **D-3104 — `COMPACT_TURN_TAIL_LINES`, its own window.** What departed: reusing `REDRIVE_TAIL_LINES`
  would have been one fewer constant. Why not: 60 lines is sized for a stall two turns deep, and this
  scan must reach back PAST a compaction's own four rows on a tail thick with attachment and system
  rows. Too small and the reader answers "no real turn in the window", which D-3103 fails open on — so
  a shared window would not have produced a false refusal, it would have produced a guard that never
  fires. What shipped: 200, and a case that pins it strictly greater than the redrive detector's.
