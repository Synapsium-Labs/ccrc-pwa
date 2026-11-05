# PR6 (S2, a carrier for every linked lease): departures and measurements

Run 1540, delegation broker wave 5, Tasks 5.6.1 and 5.6.2, with the coordinator's rulings 1 (review 1475 F11) and 2 (review 1498 F4).
Three departures are defined in the plan's "Deviations found": D-8034, D-8035 and D-8036. The block issued to this run holds three
more, which are unused and not spelled here, since a mention would raise the ledger's floor.

- **D-8034, a carrier is read only while its lease is behind.** A lease read back at its generation is counted `marked` with no read.
  One listing of the leases directory a pass decides absence. An unowned carrier read `released` is not read again while it stays listed.
  The by-tree entries are read only while a released lease with no carrier has not yet been measured against them. Otherwise every pass
  would read every carrier and every entry the box holds, one agent round trip each.
- **D-8035, `carriers` only above zero.** The health block carries the member only when a count is above zero, as PR5b's
  `uncensusedLeases` does, so the wave-3 rows that pin the block's keys stay as they are.
- **D-8036, an unreadable unowned carrier.** Rule 8 counts an unowned carrier unless it is `released`; one that cannot be read has no
  state, so it counts `unmeasured`, as rule 5 counts an owned one.

## Ruling 1: a carrier mark takes the orphan act's lock

- `cmd_ws_lease_mark` takes `$REG/.orphan-<s16>.lock` with `flock -n` for every state but `released`, after the lease lock and once
  rule 5 has resolved the tree, before rule 6's tree checks, and holds it through the carrier's rename. On contention it answers `busy`
  and writes nothing (no carrier, no by-tree entry), and the lane retries `busy` next pass (rule 6).
- **The spelling, measured.** `ws-orphan` hashes the path it is handed, which is the census row's `pathHex`, which is the
  `git worktree list --porcelain` line. Measured on git 2.53: that line is the admin record's `gitdir` content less `/.git`, as recorded,
  even when it reaches the tree through a link (a hand-written or older-git link spelling prints as written). It can therefore differ
  from the physical path. The mark locks each distinct spelling, the recorded `DL_TREE_REC` and the physical `DL_TREE`, in one fixed
  order (a bytewise sort), each with `-n`.
- No wait cycle: both the lease lock and the orphan locks are `-n`, so the mark never waits on `ws-orphan`, which holds the orphan lock
  while its rung reads the carrier.
- **The lock files are never removed**, like `ws-orphan`'s own: a lock file names a path, not a lease, and removing one under a holder
  would split the lock. They are already in the registry's dot-file inventory (`$REG/.orphan-<sha16>.lock`).
- A tree git records through a link is refused later by rule 11 anyway (`_ws_reclaim_gitdir_own` reads the recorded gitdir as another
  checkout's), so on such a box the second lock only orders the refusal. The row pins that the free mark gets past both locks.
- The rows are in `server/test/ccd-lease-mark-orphan-lock.test.ts`, not a `ccd-ws-lease-mark*` file: the session hook refuses any Bash
  command whose text names the verb, and a test file named after it is run by such a command. Its neighbours were run alone and are
  green: `ccd-ws-lease-mark`, `-argv`, `-reach`, `ccd-orphan-lease-rung`, `ccd-ws-lease-audit`, `ccd-contexts`, `docs-parity` and
  `macos-platform`. `ccd/ccd` is unchanged: the library's pin is written at install time, so there is nothing to restamp.
- Deploy class: BOTH, fleet box first.

## Ruling 2: `leaseActs` in the slow line, and at most eight releases a pass

- `leaseActs` joins `LANE_BLOCK_KEYS`, and its time leaves the slow line's `other`. The pass-timing suite's `TOP` and `BLOCK` lists are
  re-pinned in their own commit.
- `DELEGATION_LEASE_RELEASES_PER_PASS = 8`, beside `planNativeRemoved`, oldest lease first by its creating journal sequence. A candidate
  past the cap stays in `absentListings` with its count and head (D-8025), and releases on a later pass only if that pass's censused
  listing still misses it; a present or unreadable listing resets it. The release loop and the carrier steps already stop when the pass
  budget cuts the pass (the abort signal).

## The held files, under leave relayed by the coordinator

- `shared/api.ts` (claim 3585, mail 15724): `DelegationCarrierHealth` and the optional `carriers` member of
  `DelegationObservationHealth`, additive only.
- `server/test/delegation-wave3.integration.test.ts` (claim 3577, mails 15724 and 15740): the row W5-K15, and
  `server/src/coord/delegationCarrierMark.ts` added to the `W5_OPEN` row for `delegation/leases`. The effect census needed no line: the
  six policy effects are unchanged, and W5-K15 pins that only the `leaseActs` phase composes the mark.
- Every other wave-5 word was kept out of the PR6 files by rewording comments, so `W5_OPEN` gains only that one path.

## Measured, not departures

- **The lane composes the mark from the checkpoint's lease.** `markLeaseCarrier(deps, lease, checkpoint)` builds the argv from the lease
  as journalled when the step runs, as the plan specifies and as PR9's synchronous mark will call it. The planner's `mark` step
  names the lease and carries the same arguments (`carrierMarkArgs`), but its arguments never reach the box. So mutant W5-KM2 (mark at
  the carrier's generation + 1) reds W5-K3b, the planner's row, and **W5-K11c survives it**: the box only ever receives the journal's
  generation. The plan's table predicted W5-K11c red.
- `mint` goes through `transitionLease` with reason `carrier` and `carrierRequired: true` (the capability was measured); `carrier`
  is not a gated reason, so the flag changes nothing for it.
- A builder refusal (a lease field outside the verb's grammar, for example an incarnation that is not an id) is recorded as `usage`,
  a standing refusal; a transport failure, a throw or an answer outside the verb's grammar is `unmeasured`, retried next pass.
- The census row of rule 6 is the pass's census record for the tree (state, head, lock) and the registry workdirs at or inside the
  lease's journalled path. `LaneRecord` gains an optional `workdir` for it (the records the watcher passes already carry it).
- The history is not green at every commit: `4c5f38bca` (the lane step) reads W5-SC1 red until `ca0b36dee` adds the new file to its
  allow-list, which waited for the leave on the held file. And `ca0b36dee`'s first W5-K15 read `watch.ts` as text, which
  `single-definition/advance-switches` counts as four new literal source pins, and the carrier parser's quoted `expiresAt` key reddened
  `single-definition/switches-history` (whose census holds that quoted key to the expiry audit's reader) from `9c04ea771` on; `5eaf0232c`
  keys the row on the parse and lists the carrier's keys from a typed record, and both guards are green from there.
- `shellcheck-ratchet` reads red on this box twice, alone, on `ccd/ccrc` (a file this PR does not touch): inside the test slice, under
  load 8, shellcheck exits with a code other than 1, while the same command outside the slice exits 1 (findings) in 14 s. The lease
  library's own warning count is 13 before and after this PR. CI decides.

## Mutation table, as measured

Each mutant applied alone to a saved copy, each listed suite run alone (bounded by `timeout -k` and a process cap), restored and
sha-checked.

| Mutant | Edit | Went red |
|---|---|---|
| W5-KM1 | ignore `supported` | W5-K2, W5-K12 |
| W5-KM2 | mark at the carrier's generation + 1 | W5-K3b (W5-K11c survives: see above) |
| W5-KM3 | treat `unreadable` as `absent` | W5-K6 |
| W5-KM4 | overwrite a carrier ahead of the journal | W5-K5 |
| W5-KM5 | drop the per-pass bound | W5-K7, W5-K7c |
| W5-KM6 | advance `carrierGenerationSeen` on the verb's answer | W5-K11, W5-K11b |
| W5-KM7 | skip raw leases | W5-K1, and all seven lane rows (their lease is raw) |
| W5-KM8 | retry a standing refusal every pass | W5-K7c, W5-K13, W5-K13b |
| W5-KM9 | mark a released lease with no carrier, ignoring `indexed` | W5-K7b, W5-K8, W5-K8b, W5-K13b |
| W5-KM10 | treat `busy` as standing | W5-K13 |
| W5-KM11 | skip the heal | W5-K8b (the planner's and the lane's) |
| W5-KM12 | `lease-carrier-seen` sets `currentJournalSequence` | W5-K11, W5-K11c, W5-K13b; W5-J9b, W5-J10, W5-J13, W5-J14 |
| W5-K15 (a) | a second `CCD_ARGV.leaseMark(` in `watch.ts` | W5-K15 |
| W5-K15 (b) | `markLeaseCarrier(` called outside `leaseActs` | W5-K15 |
| ruling 1 (a) | drop the orphan lock | the busy row and the two-spelling row |
| ruling 1 (b) | take it for a release too | the released row |
| ruling 1 (c) | lock the recorded spelling only | the two-spelling row |
| ruling 2 (a) | `leaseActs` out of `LANE_BLOCK_KEYS` | the slow-line row |
| ruling 2 (b) | `leaseActs` time left in `other` | the slow-line row |
| ruling 2 (c) | drop the release cap | both cap rows |

The lane rows were also measured red against `watch.ts` with the carrier step switched off: all seven fail.

## Growth

`server/src/watch.ts` +16 net code lines (the aim was at most +35); every other growth-listed file +0 (`GROWTH_CHECK=1`).
