# The chained journal file's verified-head cache: the builder's notes

The builder's notes for the verified-head cache in `server/src/chainedJournalFile.ts`: the authority journal plan's "Later"
line (ruling X1), shipped by the act journal plan's question 10 (slug `act-journal-ships-the-head-cache`; ruling F16 of
review 2275) as its own small pull request in lane C, before act journal A's writer. Each departure is a plain-words slug,
never a D-number (cross-plan ruling X9). The coordinator folds what the ledger should learn into it.

## What the key proves

A hit skips re-verifying the bytes before the cached head only when the adapter can show they are the bytes it verified.

| Part of the key | Why |
|---|---|
| Device and inode | Read by the port from the descriptor the bytes came through, so a replaced file (a rename-swap, a restore, another device) is a miss even when it holds the same bytes |
| Size | The length of the verified prefix: every complete record, up to and including the head's LF. A file shorter than it is a miss |
| SHA-256 of the prefix | Covers every byte the cache stands for, so a rewrite in place, a truncate and regrow, or any other change to those bytes is a miss |

The digest is over the whole prefix, not the head's line, because a same-size rewrite of an earlier record keeps the head's
line and the file's size. One SHA-256 pass is cheap beside what it replaces: the kernel's verify decodes each line strictly,
re-encodes it canonically and hashes two preimages per record. On a hit only the bytes after the head are verified, and
their first record must continue the chain from the head (`chainNext`). Any refusal there, any defect and any miss fall back
to the whole-file verify, so every answer, its code and its detail are what a cold read answers on the same bytes. The cache
is a field of the adapter instance, in memory only: never shared across instances or paths, gone with the process.

## Departures

- **`port-reports-the-leaf-identity`.** The port's present read gains one additive field, `leaf` (device and inode), measured
  on the descriptor it read the bytes through. It is a report, never a proof; the snapshot still is. The landing journal's
  binding ignores it. The port's error unions and its one cut are unchanged, and so are the adapter's.
- **`cache-advances-only-on-a-read`.** After a successful append the cache is not moved to the record just written: the next
  read, append or cut verifies that one record from the bytes it reads. The cache only ever holds what the verifier decoded
  from bytes the port read, never a record the adapter built itself.
- **`records-handed-out-are-frozen`.** A later hit hands the same record objects out again, so every record list the adapter
  hands out, and every record in it (entry included), is frozen. No caller in the tree mutates one; every caller suite stayed
  green. A record an append returns is the one it built, not frozen, as before.
- **`adapter-guards-proven-in-the-cache-test`.** The pure decision, `verifiedHeadHolds`, joins `MUTANT_SETS` with a floor
  (`server/test/sim/chainedJournalFileSets.ts`, six mutants). The adapter's use of it (the hit, the bytes after the head, the
  key it keeps, the freezing) is a second mutant set of twelve, run by `chained-journal-file-head-cache.test.ts` over the same
  cases, every mutant killed, rather than a second floor row.
- **`plan-contract-text-says-whole-file`.** X1's contract and the authority plan's question 3 say `appendNext` "re-reads and
  verifies the whole file". It still re-reads the whole file on every call and never reuses a snapshot; the bytes before a
  held head are verified by their digest instead of by the kernel. The adapter's header states the cache beside the
  contract; the plan's text is the coordinator's to amend.
- **`the-port-still-reads-the-file-four-times`.** What an append still costs at 100,000 records is the port's own proof: its
  read, and the whole-file re-reads `appendLine` makes before and after it writes (the re-proof, the open's comparison and
  the post-proof). They are the port's guarantee against a second writer and are untouched here. A cheaper proof (for
  example, comparing sizes and a tail digest before a full comparison) is a later line, not this pull request's.

## Measured

One append and one head read on a fixture directory, main's adapter against this branch's, through a fixture format whose
entry is about 160 bytes (about 509 bytes a record), each after one warm-up read of the same instance, the median of five
rounds, on the fleet box at a load average of about 12 (figures move by up to a factor of two between runs).

| Records | File | Adapter | One append | One head read |
|---|---|---|---|---|
| 10,000 | 5.1 MB | main (no cache) | 191 ms | 145 ms |
| 10,000 | 5.1 MB | this branch | 58 ms | 10 ms |
| 100,000 | 50.9 MB | main (no cache) | 1,310 ms | 1,237 ms |
| 100,000 | 50.9 MB | this branch | 251 ms | 139 ms |

A fresh instance's first read is a whole-file verify plus one SHA-256 pass and the freeze: at 100,000 records it measured
1,343 ms without the freeze and 1,432 ms with it, against main's 1,359 ms (which run went first moved these by more than the
difference). A second run of this branch measured an append of 150 to 159 ms and a head read of about 80 ms at 100,000
records. The act journal's Task A2 measures again; this measure gates nothing (F16).
