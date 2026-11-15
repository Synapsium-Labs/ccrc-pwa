# Overlord W1a, timers: departures from the plan

Each departure from `w1a-timers.md` is named by a slug. No D-number is taken here: the coordinator folds these into the
programme's ledger. The plan's own decisions (its "Deviations found" list) stand unless a slug below changes one. This
note starts with PR A (Tasks 1 to 3); PRs B to E add their sections below.

## Spec departures, for the spec's next correction

Both come from the plan's "Deviations found" and are recorded here as the plan asks.

- **stall-notice-names-no-note** — C65 says a stall notice after the hold names the timer, its due time "and the first
  words of its note". The notice names the id and the due time only, because stall notices go out as `operator` and C63
  (H7) and the stall text rule keep a session's words out of that envelope (the coordinator's ruling on review 2030 F3).
  Built in PR C (Task 9).
- **timer-gate-fails-open-like-every-gate** — Table 11.1d and C65 say `ccrc-api` answers `capability-missing` without
  `timers-v1`. It does so on a current cap file only, and sends the request on an absent, stale or torn one, as every
  gate in the client does (the coordinator's ruling on review 2030 m3). Built in PR D (Task 11).

## The open questions' defaults

The four defaults the coordinator kept on review 2030: **reclaim-reads-gone**, **no-restore-generation-reader**,
**m36-refusals-unrecorded** and **incarnation-reason-is-a-string**. PR A builds the deciders the first and last rest on:
`timerCleanupVerdict` takes the incarnation as `measured`, `absent` or `unmeasured`, and only `absent` can cancel; the
literal `'absent'` comparison is the lane's input builder's (PR C).

## PR A: the vocabulary, the deciders, the table (Tasks 1 to 3)

### The vocabulary (Task 1)

- **timer-actor-list** — `TimerActor` gets a sibling `Record<TimerActor, true>` map and the derived `TIMER_ACTORS`. The
  wire-totality scan (`server/test/rings/wire-totality.test.ts`) refuses an exported literal union in `shared/` without
  one, and the vocabulary test walks every actor with it.
- **timer-refusals-are-a-status-record** — `TIMER_REFUSALS` is declared as the ten words with their statuses in one
  record, spread into `REFUSAL_STATUS` (`LEASE_DOOR_REFUSALS`' idiom), so each word and its status are written once.
- **undecided-role-gets-the-least-cap** (the plan's) — the column holds the seven roles' caps; the `undecided` reading's
  5 is the set door's to apply (PR B), as the plan says.

### The deciders (Task 2)

- **cleanup-run-and-programme-first** — the order is the plan's: a closed run or an ended programme cancels before the
  `listedAt` rung, so a timer whose run closed is cancelled even when it was set after the tick's listing began. The case
  is pinned, with a mutant (K14) that moves the listing rung first.
- **archived-reads-alone** — `setter-archived` reads the listing's `archived` alone (the brief: `archivedAt !== null`),
  not `listed && archived`: the lane only finds an archive stamp on a row the listing built.
- **preview-ellipsis-inside-the-sixty** — `timerPreview`'s "at most 60 code points" counts the ellipsis: a cut keeps at
  most 59 code points and adds `…`. A head that ends inside a word backs off to the last space before it that has words
  before it; a head with no such space (one long word, or a leading space and then one long word: review 2038 F2) is
  hard-cut at 59, and trailing space is trimmed, so a note with words never previews as the ellipsis alone. A note of 60 or fewer is itself, uncut.
  It does not fold line breaks: the card's one-line rule (`card.ts#oneLine`, PR D) applies where the line is drawn.
- **timer-mail-lines** — the plan names what each timer's lines say; the words are: `Timer <id>: due <UTC>, fired <n>
  min late.` (whole minutes from `dueAt` to now, floored, never below 0), then `Credited to <setById> at <UTC>; run <n>.`
  (or `programme <slug>.`, or `no run or programme.`), then the untrusted block. Stamps are `card.ts#iso`, the card's own
  absolute UTC, so the two read alike. Timers are separated by a blank line. The subject joins its ids with `, ` and, when
  they do not all fit in 200 bytes, ends `, …)` after the ids that do.
- **one-mail-per-group-a-pass** — `packTimerMail` stops a group at the first timer that would not fit (oldest first), and
  the rest of that group waits for the next pass, as the plan says. Groups are ordered by their oldest due timer.

### The table and its writers (Task 3)

- **fire-is-a-savepoint** — `markTimersFired` undoes its own writes through a savepoint before it throws, so it is all or
  nothing on its own as well as inside the lane's `tx`, which then rolls the mail back with it.
- **sets-since-throws** — `setsSince` answers a number, and a failed read throws rather than answering 0; the set door
  maps the throw to `timer-unmeasured` (PR B), so a box fault never reads as "no sets this hour".
- **timer-row-role-is-a-string** — a row's `role` reads back as the stored word, not narrowed to `FleetRole`: a newer
  build may store a role this one does not know, and nothing in W1a decides on a stored role.
- **store-delegates-through-a-namespace** — `store.ts` imports the timer functions as one namespace
  (`import * as timers from '../continuity/continuityStore.js'`) rather than widening the shared named import that the
  generations and card delegates use, which other W1a pieces edit at the same time.
- **migration-slot-measured** — migration 70, measured on `origin/main` at `9e55a891a` (69 entries). The notes piece
  (#2796) and launch profiles PR B (#2794) each add a migration too; whichever lands later merges `main` once, takes the
  next slot and re-counts (`coord-db.test.ts`'s pins and `run-close-switch.test.ts`'s rollback list).

### Fix round 1 (review 2038, the coordinator's rulings)

- **too-late-past-the-bound** (F3, ruled: the spec over the plan) — any number past `TIMER_DUE_MAX_MS`, an unsafe
  positive integer and `+Infinity` included, answers `timer-too-late` (Table 11.6, C65). Everything else that is not a
  safe integer of at least five minutes answers `timer-too-soon`: under five minutes, zero, a negative, `-Infinity`,
  `NaN`, a fraction, or a value that is not a number. The plan's sentence ("`timer-too-soon` (not a safe integer, or
  under five minutes)") read the first group as too soon. PR B's door tests pin both groups through the door.
- **preview-backs-off-only-to-words** (F2) — the correction to preview-ellipsis-inside-the-sixty above, with its case
  and mutant.
- **bound-key-that-does-not-read-fails** (F5) — a stored `runId` that is neither null nor a number fails the whole read,
  as every other bad column does, rather than reading as an unbound timer. The same rule holds for `programme` (neither
  null nor text), which folded the same way; under the column's TEXT affinity only a blob reaches it.
- **pack-order-pinned** (F1) — no behaviour change: two cases and two mutants pin that a timer that does not fit stops
  its group (a smaller, later timer never rides ahead of it) and that timers due at the same instant go in id order.
- **carried to PR B** (F4, F6) — the set door pins the bounds on the credited id and the programme, a throwing
  `setsSince` answers `timer-unmeasured` (503), and `write-failed` answers 503. Nothing changes in PR A.

## Growth (PR A)

Measured against the merge base before the push; see the PR body for the figures.
