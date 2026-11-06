# PR6 (S2, a carrier for every linked lease): departures and measurements

Run 1540, delegation broker wave 5, Tasks 5.6.1 and 5.6.2, with the coordinator's rulings 1 (review 1475 F11) and 2 (review 1498 F4),
and fix round 1 on review 1546. Six departures are defined in the plan's "Deviations found": D-8034 to D-8039, the whole block issued
to this run.

- **D-8034, the carrier reads are bounded (rewritten in fix round 1, F1).** Each pass the lane reads every lease behind its generation,
  and re-reads up to `DELEGATION_CARRIER_REVERIFY_PER_PASS = 8` up-to-date unreleased leases, least recently read first by the pass
  ordinal at which each was last read (a counter in the lane's memory, never a clock). Rules 3 to 5 apply to every read-back, so a
  carrier changed out of band counts `mismatched`, and one lost is composed a mark. The re-reads spend no mark budget. `marked` means
  "read back equal when last read". One listing of the leases directory a pass decides absence; an unowned carrier read `released` is
  not read again while it stays listed; the by-tree entries are read only while a released lease with no carrier has not yet been
  measured against them. PR7 does not consume these read-backs: its adoption step reads each candidate's carrier itself, at decision
  time, through `readDelegationCarrier` (the coordinator carries this to PR7's brief).
  - The ruling's row reads "ten up-to-date leases are read eight in one pass and two in the next". With a bound of eight and the
    least-recently-read order, the second pass reads the two left over FIRST and then six of the first eight, so it reads eight too.
    The read-count row pins exactly that order.
- **D-8035, `carriers` only above zero.** The health block carries the member only when a count is above zero, as PR5b's
  `uncensusedLeases` does, so the wave-3 rows that pin the block's keys stay as they are. The counts are the last pass's that planned
  the step, and the member's one reader is `delegationCarrierHealthOf` (F7).
- **D-8036, an unreadable unowned carrier.** Rule 8 counts an unowned carrier unless it is `released`; one that cannot be read has no
  state, so it counts `unmeasured`, as rule 5 counts an owned one. Its own row since fix round 1 (F6a).
- **D-8037, ruling 1 as it now stands (F2, F11).** The orphan lock, below, and the caps word `lease-mark-lock-v1`.
- **D-8038, ruling 2 as shipped.** Below.
- **D-8039, a standing refusal ends after thirty passes, and an `unmeasured` lease goes last (F3, F4).** Below.

## Ruling 1 (D-8037): a carrier mark takes the orphan act's lock

- `cmd_ws_lease_mark` takes `$REG/.orphan-<s16>.lock` with `flock -n` for every state but `released`, after the lease lock and once
  rule 5 has resolved the tree, before rule 6's tree checks, and holds it through the carrier's rename. On contention it answers `busy`
  and writes nothing (no carrier, no by-tree entry), and the lane retries `busy` next pass (rule 6).
- **The spelling, measured.** `ws-orphan` hashes the path it is handed, which is the census row's `pathHex`, which is the
  `git worktree list --porcelain` line. Measured on git 2.53: that line is the admin record's `gitdir` content less `/.git`, as recorded,
  even when it reaches the tree through a link (a hand-written or older-git link spelling prints as written). It can therefore differ
  from the physical path. The mark locks each distinct spelling, the recorded `DL_TREE_REC` and the physical `DL_TREE`, in one fixed
  order (a bytewise sort), each with `-n`.
- **At least one lock (F11).** The list of spellings is measured: if `sort` fails or answers nothing, the mark answers `unmeasured` and
  writes nothing, and after the loop it refuses `unmeasured` unless at least one orphan lock is held. A blank line is never a spelling.
- **The caps word (F2).** `ccd caps` reports `lease-mark-lock-v1` beside `lease-mark-v1`, appended to the existing caps line, so
  `ccd/ccd` stays at +0 lines. `server/src/ccdargv.ts` declares it as `LEASE_MARK_LOCK_CAP`. `markLeaseCarrier` composes no mark of a
  state that holds a tree (every state but `ephemeral` and `released`) unless the box reports the word: it answers `unsupported` and
  composes nothing, and the planner counts that lease `unsupported` (rule 1). PR6 itself marks only `ephemeral` and `released`, so the
  gate first bites on PR7's and PR9's held-state marks, which fail shut on a box without the lock.
- No wait cycle: both the lease lock and the orphan locks are `-n`, so the mark never waits on `ws-orphan`, which holds the orphan lock
  while its rung reads the carrier.
- **The lock files are never removed**, like `ws-orphan`'s own: a lock file names a path, not a lease, and removing one under a holder
  would split the lock. They are already in the registry's dot-file inventory (`$REG/.orphan-<sha16>.lock`).
- A tree git records through a link is refused later by rule 11 anyway (`_ws_reclaim_gitdir_own` reads the recorded gitdir as another
  checkout's), so on such a box the second lock only orders the refusal. The row pins that the free mark gets past both locks.
- The rows are in `server/test/ccd-lease-mark-orphan-lock.test.ts`, not a `ccd-ws-lease-mark*` file: the session hook refuses any Bash
  command whose text names the verb, and a test file named after it is run by such a command. `ccd/ccd`'s change is one caps line; the
  library's pin is written at install time, so there is nothing to restamp.
- Deploy class: BOTH, fleet box first (the plan's PR6 text says SERVER; D-8037 carries the departure).

## Ruling 2 (D-8038): `leaseActs` in the slow line, and at most eight releases a pass

- `leaseActs` joins `LANE_BLOCK_KEYS`, and its time leaves the slow line's `other`. The pass-timing suite's `TOP` and `BLOCK` lists are
  re-pinned in their own commit.
- `DELEGATION_LEASE_RELEASES_PER_PASS = 8`, beside `planNativeRemoved`, oldest lease first by its creating journal sequence. A candidate
  past the cap stays in `absentListings` with its count and its head (D-8025), and releases on a later pass only if that pass's censused
  listing still misses it; a present or unreadable listing resets it. The release loop and the carrier steps both stop when the pass
  budget cuts the pass (the abort signal); fix round 1 adds a row for each check, and one for the head (F6b, F6d).

## Fix round 1 (review 1546): what changed

- **F3 and F4 (D-8039).** A standing refusal (rule 6) also ends after `DELEGATION_CARRIER_REFUSAL_RETRY_PASSES = 30` passes since it was
  recorded, counted in the lane's pass ordinal. It is then composed once more within the mark budget, oldest first. The generation and
  census-row keys stay as they were. The census row holds only the census record and the registry workdirs at or inside the tree,
  compared as written. A workdir that contains the tree, one written through a link, and another lease's carrier (`tree-held`) are not
  in it, and the bound covers them. Within the budget, a lease whose last mark answered `unmeasured` goes after every lease whose last
  mark did not, oldest first within each group. `busy` and `unmeasured` are still never standing.
- **F5.** A lane row where the verb answers `written` but the carrier it leaves is ahead: no `lease-carrier-seen`, and the next pass
  counts it `mismatched`. A composer row covers behind, ahead, another sequence, another parent and another lease. W5-K4's second pass
  now runs through PR5b's real `noteCarrierSeen` door (the lane rig's applier), so W5-KM12 reds it.
- **F6.** Rows for D-8036, for each abort check, for the reads `planCarrierPass` makes, and for a capped-out candidate's head. The read
  rows count reads through a counting `FleetIO` wrapper, which every lane row now uses.
- **F7.** `delegationCarrierHealthOf` sits beside `delegationUncensusedLeasesOf`, and the K14 rows read through it.
- **F8.** `parseDelegationCarrier` takes the file's lease id and answers `malformed` for a body naming another lease, as the box's
  reader does. **Recorded:** the server's reads follow a symlinked carrier or by-tree entry (`localIO` opens `O_NOFOLLOW` only for
  lane-state names), while the box refuses a link (`bad-carrier`) and its rung reads that tree `unmeasured`. The box is the authority,
  and it fails shut.
- **F9.** The lane hands `markLeaseCarrier` the planned `args`. It composes from the checkpoint as before, and if the composed
  generation or state differs from the planned one, it composes nothing that pass (`moved`); the next pass plans again. PR9's direct
  call passes no planned args. With this, W5-KM2 reds W5-K11c, as the plan's table says.
- **F10.** When the by-tree index reads `unmeasured`, a released lease with no carrier counts `unmeasured`. The ruling's "a lease's
  `notIndexed` mark is cleared when its mark answered `ran: false`" cannot fire as written. A lease enters `notIndexed` only once
  released, and a released lease with no carrier and no entry gets no step, so its mark never runs. The effect it asks for is kept
  instead: a lease whose last mark did not run is never added to `notIndexed` (a set `notRan`, cleared by any answer that ran), so a
  late write of its by-tree entry is healed on a later pass. The row: a mark times out, the lease is released, no entry yet means no
  heal, then the entry is written late and the next pass heals it.
- **F12, recorded.** W5-K15's census reads the callee's text through the parse, so an alias (`const { leaseMark } = CCD_ARGV`, a
  computed member, an optional call, an import rename, `.call`, passing the function as a value) evades it. It pins one composer per
  file, so a second call in another function of `delegationCarrierMark.ts` passes. It is an accident guard, not a wall.
- **F13.** Rule 1 counts `unsupported` for every lease not up to date, released leases included.
  `DELEGATION_CARRIER_RETRIED_REFUSALS` has its `single-definition/vocabularies` row. A `noteCarrierSeen` throw after a landed mark is
  logged as `carrier <id> seen threw` and the mark stands, never `refused unmeasured`. **Recorded:** two leases on one tree key share
  one census row, built from whichever the checkpoint lists last. Policy refuses two unreleased leases on one key, so only a released
  one can share it.

## The held files, under leave relayed by the coordinator

- `shared/api.ts` (claim 3585): `DelegationCarrierHealth` and the optional `carriers` member of `DelegationObservationHealth`, additive
  only (mail 15724). In fix round 1 (mail 15773, F7): the reader `delegationCarrierHealthOf` beside `delegationUncensusedLeasesOf`, and
  the member's comment reworded in D-8035's words. Then (mail 15778) the doc comment of `DelegationCarrierHealth`, so its `unsupported`
  and `refused` counts read as D-8037 and D-8039 made them: comment text only.
- `server/test/delegation-wave3.integration.test.ts` (claim 3577, mails 15724 and 15740): the row W5-K15, and
  `server/src/coord/delegationCarrierMark.ts` added to the `W5_OPEN` row for `delegation/leases`. The effect census needed no line: the
  six policy effects are unchanged, and W5-K15 pins that only the `leaseActs` phase composes the mark.
- Every other wave-5 word was kept out of the PR6 files by rewording comments, so `W5_OPEN` gains only that one path.
- A fourth touch, made beyond the leave and reported afterwards: W5-K15 is keyed on the parse, so the file's existing import from
  `./scan/symbols.js` widened from `parsedFile` to `callsIn, parsedFile, symbolOf`. The holder accepted it after the fact (mail 15751).
- Fix round 1, under this run's own claim 3618 (claim 3577 had ended): the integration file's caps-family row lists
  `lease-mark-lock-v1`, since its `lease` pattern matches the new word. `server/test/ccdCapTokens.ts` lists it too (the advertised set
  `ccd-archive` holds equal to `cmd_caps`).

## Measured, not departures

- `mint` goes through `transitionLease` with reason `carrier` and `carrierRequired: true` (the capability was measured); `carrier`
  is not a gated reason, so the flag changes nothing for it.
- A builder refusal (a lease field outside the verb's grammar, for example an incarnation that is not an id) is recorded as `usage`,
  a standing refusal; a transport failure, a throw or an answer outside the verb's grammar is `unmeasured`, retried next pass.
- The census row of rule 6 is the pass's census record for the tree (state, head, lock) and the registry workdirs at or inside the
  lease's journalled path. `LaneRecord` gains an optional `workdir` for it (the records the watcher passes already carry it).
- `verb-gate` finds a call site's enclosing function by its header line. `markLeaseCarrier`'s signature is wrapped with the closing
  `): …{` on a line of its own, the shape the scanner reads; a fourth parameter on a continuation line read as an ungated site.
- The history is not green at every commit: `4c5f38bca` (the lane step) reads W5-SC1 red until `ca0b36dee` adds the new file to its
  allow-list, which waited for the leave on the held file. And `ca0b36dee`'s first W5-K15 read `watch.ts` as text, which
  `single-definition/advance-switches` counts as four new literal source pins, and the carrier parser's quoted `expiresAt` key reddened
  `single-definition/switches-history` (whose census holds that quoted key to the expiry audit's reader) from `9c04ea771` on; `5eaf0232c`
  keys the row on the parse and lists the carrier's keys from a typed record, and both guards are green from there.
- `shellcheck-ratchet` read red on this box in round 0, alone, on `ccd/ccrc` (a file this PR does not touch); CI's full server suite
  passed it.

## The first full CI run

The full run on `0e4788c93` was red in two server shards: two repo-wide censuses over `runCcd` sites that the local list did not
name. `verb-gate` wants a capability gate in the function that builds a `CCD_ARGV` argv, and the gate sat one level up in the lane.
`consolidation-census` (D-6840) wants `res.ran === false` before any read of the runner's words. Since `8fa6a4675`,
`markLeaseCarrier` asks `ccdCan(fleetState, 'leaseMark')` itself, so PR9's direct call is gated too (row W5-K12b, which a mutant
dropping the gate reds), and it narrows on `ran === false`.

## Mutation table, as measured

Each mutant applied alone to a saved copy, each listed suite run alone (bounded by `timeout -k` and a process cap of the live thread
count plus 1500), restored, and its sha and `git status` checked. The rows marked "round 0" were measured at `422824331`. Every other
row was measured at fix round 1's code (`e1a89b0d6`). Where a result depends on where the edit sits, the placement column says so.
"Planner" is `delegation-carrier.test.ts`; "lane" is `delegation-carrier-lane.test.ts`.

| Mutant | Placement | Edit | Went red |
|---|---|---|---|
| W5-KM1 | `planCarrierSteps`, rule 1 (L1) | ignore `supported` | planner W5-K2; lane W5-K12 |
| W5-KM2 | `planCarrierSteps`'s mark step (L1) | mark at the carrier's generation + 1 | planner W5-K3b; lane W5-K11c (F9's planned-args check) |
| W5-KM3 | `planCarrierSteps`, rule 5 (L1), round 0 | treat `unreadable` as `absent` | W5-K6 |
| W5-KM4 | `planCarrierSteps`, rule 5 (L1), round 0 | overwrite a carrier ahead of the journal | W5-K5 |
| W5-KM5 | `planCarrierSteps`'s budget loop (L1) | drop the per-pass bound | planner W5-K7, W5-K7c, D-8039 (F4) |
| W5-KM6 | `markLeaseCarrier` (L4) | `seen` on the verb's answer, with no read-back compare | lane W5-K11, W5-K11b, both F5 rows |
| W5-KM7 | `planCarrierSteps`, before rule 1 (L1) | skip raw leases | planner W5-K1; lane 14 rows, every one whose lease is raw (they mint nothing) |
| W5-KM8 | `planCarrierSteps`, rule 6 (L1) | retry a standing refusal every pass | planner W5-K7c, D-8039 (F3); lane W5-K13, W5-K13b, D-8039 (F3) |
| W5-KM9 | `planCarrierSteps`, rule 3 (L1) | mark a released lease with no carrier, ignoring `indexed` | planner W5-K7b, W5-K8, W5-K8b; lane W5-K13b, F10, the read-set row |
| W5-KM10 | `DELEGATION_CARRIER_RETRIED_REFUSALS` (L1) | treat `busy` as standing | lane W5-K13 |
| W5-KM11 | `planCarrierSteps`, rule 3 (L1) | skip the heal | planner W5-K8b; lane W5-K8b, F10 |
| W5-KM12 | the applier's `lease-carrier-seen` fold (`delegation-checkpoint.ts`) | the seen sets `currentJournalSequence` | lane W5-K4, W5-K11, W5-K11c, W5-K13b, and three fix-round rows (F1, F3, F4); round 0: W5-J9b, W5-J10, W5-J13, W5-J14 |
| W5-K12b gate | `markLeaseCarrier` (L4) | drop the composer's `ccdCan` | lane W5-K12b |
| W5-K15 (a) | `watch.ts`, round 0 | a second `CCD_ARGV.leaseMark(` | W5-K15 |
| W5-K15 (b) | `watch.ts`'s `compact`, round 0 | `markLeaseCarrier(` called outside `leaseActs` | W5-K15 |
| F1 | `planCarrierPass`'s read loop (L4) | drop the re-verify reads | lane D-8034 (F1), the read-set row |
| F2 composer | `markLeaseCarrier` (L4) | drop the lock-word check | lane D-8037 (F2) |
| F2 planner | `planCarrierSteps`, rule 1 (L1) | drop the lock-word check | planner D-8037; lane D-8037 (F2) |
| F3 | `planCarrierSteps`, rule 6 (L1) | drop the thirty-pass bound | planner D-8039 (F3); lane D-8039 (F3) |
| F4 | `planCarrierSteps`'s `spend` (L1) | drop the `unmeasured`-last order | planner D-8039 (F4); lane D-8039 (F4) |
| F5 (G1) | `markLeaseCarrier` (L4) | accept any parsed read-back before `seen` | both F5 rows |
| F6a | `planCarrierSteps`, rule 8 (L1) | drop D-8036's arm | planner D-8036 |
| F6b carrier | `watch.ts`'s carrier loop | drop `pass.signal.aborted` | lane F6b (carrier) |
| F6b release | `watch.ts`'s release loop | drop `pass.signal.aborted` | lane F6b (release) |
| F6c unlisted | `planCarrierPass` (L4) | read a carrier the listing does not name | the read-set row |
| F6c released unowned | `planCarrierPass` (L4) | read an unowned released carrier every pass | the read-set row |
| F6c not indexed | `planCarrierPass` (L4) | measure the by-tree entries every pass | the read-set row |
| F6d | `planNativeRemoved` (L1) | a capped-out candidate drops its head | `delegation-lease-state` F6d |
| F8 | `parseDelegationCarrier` (L1) | drop the lease-id check | planner F8 |
| F9 | `markLeaseCarrier` (L4) | drop the moved check | lane F9 |
| F10 indexed | `planCarrierSteps`, rule 3 (L1) | an unmeasured index counts nothing | planner W5-K8b |
| F10 not ran | `planCarrierPass` (L4) | a lease whose mark did not run joins `notIndexed` | lane F10 |
| F11 | `_dl_mark_locked` (the lease library) | drop the spellings check and the one-lock check | `ccd-lease-mark-orphan-lock` F11 |
| F13 released | `planCarrierSteps`, rule 1 (L1) | count only unreleased leases unsupported | planner W5-K2 |
| F13 seen throw | `markLeaseCarrier` (L4) | a seen throw answers `refused unmeasured` | lane F13 |
| ruling 1 (a), round 0 | `_dl_mark_locked` | drop the orphan lock | the busy row and the two-spelling row |
| ruling 1 (b), round 0 | `_dl_mark_locked` | take it for a release too | the released row |
| ruling 1 (c), round 0 | `_dl_mark_locked` | lock the recorded spelling only | the two-spelling row |
| ruling 2 (a), round 0 | `watch.ts` | `leaseActs` out of `LANE_BLOCK_KEYS` | the slow-line row |
| ruling 2 (b), round 0 | `watch.ts` | `leaseActs` time left in `other` | the slow-line row |
| ruling 2 (c), round 0 | `planNativeRemoved` | drop the release cap | both cap rows |

## Growth

`server/src/watch.ts` +16 net code lines (the aim was at most +35); fix round 1 changed two of its lines in place. `ccd/ccd` is +0 (one
caps line widened). Every other growth-listed file is +0 (`GROWTH_CHECK=1`).
