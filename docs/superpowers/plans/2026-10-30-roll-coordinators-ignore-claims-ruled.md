# The automatic roll: a coordinator's claimed runs and claims do not hold it, ruled

## Deviations found

- **D-7562 (2026-10-30)** — Rolls only: claimed runs and claims do not hold the automatic coordinator roll

**Why.** Measured after the automatic coordinator roll (D-7452, D-7458) was deployed: the roll lane held EVERY live
coordinator with `idle-gate:run-claimant` or `idle-gate:claim`. The roll's idle gate is hibernation's
(`hibernateVerdict`, the one ladder `decideSleep` runs), and that gate holds a session that claims any open run
(every state outside the terminal set, `planned` included) or holds a live claim. Every live coordinator claims at least
one open run, and stale planned runs count, so no coordinator ever rolled.

**The ruling (operator, 2026-10-30).** For ROLLS ONLY, claimed runs and claims do not block: a roll comes straight back
as the same session, and its claims and runs stay in the coordination store. A roll is still held when the pane is
busy, the operator is attached, there is a draft, a hold or a `.no-roll` marker is set, or by any other hold the roll
target already applies. The hibernation lane, and every other caller of the shared idle gate, keep their run gate
unchanged.

**What changed.**

- `server/src/coord/hibernate.ts`: `hibernateVerdict` takes a fourth, optional argument, `IdleGateOptions`
  (`{ claims: 'hold' | 'pass' }`). Its default, `IDLE_GATE_HOLDS_CLAIMS`, is `hold`: every existing caller (the
  hibernation lane, its census and pins) passes nothing and answers as before. Under `pass`, the store reads as claiming
  no open run and holding no claim before the ladder runs, so `run-claimant` and `claim` cannot hold. Nothing else
  changes: an unreadable store still holds `runs-unreadable`, and an open run naming the session as worker, outstanding
  mail, a hold, a viewer, the live word, the turn marker and the quiet window all still hold.
- `server/src/coord/rollTarget.ts`: `ROLL_IDLE_GATE` (`{ claims: 'pass' }`) is the roll's gate, used by
  `autoRollVerdict` and nowhere else.
- `hibernation-due` asks hibernation's OWN gate (claims holding): hibernation never takes a coordinator that claims a run
  or holds a claim, so such a coordinator is never "left to hibernation", which would hold it off the roll for good once
  hibernation is armed.
- The act is unchanged: `ccd hibernate --roll` still re-measures the box-local half (a draft, `esc to interrupt`, an
  attached terminal, the turn marker, a swap landing, `.no-roll`, a hold) and refuses at exit 3, which is the lane's skip.
  It never read claims.

**Red first.** `server/test/roll-target.test.ts` "claimed runs and claims do not hold a roll (D-7562)": a coordinator
idle past 90 minutes claiming planned runs rolls; one holding a claim rolls; one claiming a dispatched run its child
works rolls; with claims, a busy, open-on-screen or not-yet-quiet one, a hold, an open run naming it as worker, mail
and an unreadable store still hold; `.no-roll` and a non-coordinator still never roll; a claimant hibernation would
otherwise be due for rolls; and the pin that hibernation's own verdict still holds `run-claimant` and `claim`.
`server/test/roll-lane.test.ts` "rollPass: claimed runs and claims do not hold a roll (D-7562)" holds the same on a real
coordination store: planned runs and a dispatched run with a live child roll; a busy coordinator is held by the gate; an
attached or drafting one is refused by ccd at the act; a non-coordinator never rolls; an open run naming the
coordinator as worker still holds; undelivered mail to a coordinator with claims still holds `idle-gate:mail`. `server/test/hibernate-sweep.test.ts`'s claimant rows (every open state holds
`run-claimant`) are unchanged and green.

**Mutants, measured** (each run one file at a time against `roll-target`, `roll-lane`, `hibernate-verdict`,
`hibernate-sweep` and `sleep-lanes-pin`; the counts are failing tests):

- The default flipped to `pass` (`IDLE_GATE_HOLDS_CLAIMS` passing claims): 22 red, `roll-target` 2, `hibernate-verdict`
  3, `hibernate-sweep` 9, `sleep-lanes-pin` 8, `roll-lane` 0.
- The roll's gate set to `hold` (`ROLL_IDLE_GATE` holding claims, the bug): 11 red, `roll-target` 6, `roll-lane` 5 (4 on
  the red-first commit, plus the mail row, which then reads `idle-gate:run-claimant`).
- Under `pass`, the claimed open run kept (only the claim cleared): 10 red, `roll-target` 5, `roll-lane` 5.
- Under `pass`, the claim kept (only the claimed open run cleared): 9 red, `roll-target` 5, `roll-lane` 4.
- Under `pass`, mail cleared too: 2 red, `roll-target` 1, `roll-lane` 1.
- Under `pass`, an open run naming it as worker cleared too: 2 red, `roll-target` 1, `roll-lane` 1.
- `hibernation-due` asking the roll's gate instead of hibernation's own: 1 red, `roll-target` 1.

## Residuals, named

- A child's prompt raised while its coordinator sleeps through a roll, or after the roll's wake failed, goes to the
  operator (`parent-not-live`), as it does for any claimant that is not live. The roll does not hold for it.
- A failed roll wake can leave a coordinator that claims runs hibernated. It still reads as alive to reclaim, so its runs
  are not taken from it, and its children's mail wakes it.
