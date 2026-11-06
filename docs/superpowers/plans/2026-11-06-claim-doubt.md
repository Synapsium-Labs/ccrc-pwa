# Claim doubt and the old dead reads

**Applies:** D-6908 (`claim-probe-doubt`, defined in `2026-10-25-arch-48-presence-dead-since.md`), ruled by the operator on
2026-11-06 as "doubt means keep: renew, up to the 8-hour cap", together with the ruling to move two readers and record the
rest.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (K3). **Finishes the one reader #783 left open.**

## What moved

`rowStanding` (`server/src/sessionReading.ts`) reads one frame row as `here`, `doubt`, `asleep` or `gone`, from `presence`
and, for the one row where `presence` says `alive` over a gone pane, the `restarting` lifecycle. Both readers go through it,
so they cannot disagree on doubt.

| Row | `claimProbe` before | after | Delegation word before | after |
| --- | --- | --- | --- | --- |
| tmux did not answer | `gone` | `unmeasurable` | `stale` | `unmeasured` |
| restarting (fresh heartbeat, pane gone) | `gone` | `unmeasurable` | `stale` | `unmeasured` |
| asleep | `gone` | `gone` | `stale` | `asleep` |
| dead | `gone` | `gone` | `stale` | `stale` |
| listed but refused | `unmeasurable` | `unmeasurable` | `stale` | `unmeasured` |
| not listed | `gone` | `gone` | `stale` | `stale` |

`asleep` is a new `DelegationLiveness` word, drawn as "session asleep". It is additive: an older PWA reads a word it has
never heard of as `unmeasured`.

## Deviations found

- **D-8090 (2026-11-06)** — accepted old dead reads and the count that stops new ones. `server/test/single-definition/old-dead-reads.test.ts`
  names every remaining `status` compare with `'dead'` in `server/src` and `shared`, and a new one is red until it has a
  row. A row is one edit in that test file, in the same PR, with no ledger, switch or operator step, so the count cannot
  block unrelated work.

  The ruling counted five other server reads and one in shared code. The scan finds nine rows in all: the five (four in
  `watch.ts`, `paneDead` in `hibernate.ts`), the frame assembly's own read in `fleet.ts`, and three in `shared/api.ts`
  (`sessionBucket` twice, `inArchivedFold`).

  The four leftovers the spec marked deleted are accepted as they stand. The ruling does not list them; this is the
  reading of K3's list against the code on 2026-11-06, and a reader of the ruling should correct it if it meant others:
  `turnverdict.liveRowFor`'s one-row `assembleFleet`, the raw tmux read in `commands.ts` (`sessionCommands`), the raw pane
  read in `coord/routes.ts`, and the PWA's `coordinatorPresence` (the spec's `coordPresence`), which stayed for its two
  rulings D-7370 and D-7371. None of them is a `status` compare, so the count does not hold them.
