# The temp-root collector and a recorded device that is gone from the box — task note

Programme `overlord`. A small independent PR off `main`. The departure is named by slug,
`D-8948`: no number was issued to this session, so the placeholder stands in the source
comments until one is, and `dtbd.test.ts` is red until then, as it is built to be. The entry for a plan's
`## Deviations found` is the section "The departure, for the ledger" below; it is defined when the number is issued.

## What was measured

On a fleet, on 2026-11-22, the fleet box's disk was nearly full and its session temp area (the directory that holds one
temp root per session) was a large part of it.

- Several dozen temp roots there belonged to sessions that no longer existed: no registry files, no terminal session.
- The temp-root collector (the server's collect lane composing `ccd ws-collect`), armed live, removed none of them.
- The console listed most of them under "ccd cannot collect its temp root as it stands, and this does not heal by
  itself", and the rest under a terminal word.
- The feed carried ccd's own answers. Most were unmeasured `device`: the temp area is on one device, not on the device
  that the witness of the id, or the quarantine record of the id, carries. A few were `containment-unproven`: a scratch
  checkout inside the temp root names, as its git directory, a path of a layout that no longer exists. One was
  `quarantine-kept` after a removal failed inside a quarantine slot. Some were `registered`: a child marker of the id
  still stood, though no session did.

The fleet had been moved to another machine. Every witness and every quarantine record written before the move
carries the device number of the old machine's storage, which the new box will never have.

## Why it never healed

The collector believes an ABSENCE only on the device its witness or its record carries (`_ws_collect_root_dev`, spec
§5.10). The rule is a safety rule and it is right: with the temp area's volume unmounted and its mount point standing
empty, every leaf and every slot reads absent, and acting on that would drop witnesses and records over data that is
still there. Two arms ask it: a witness whose leaf is proven absent, and a quarantine record whose slot is empty.

Nothing re-witnesses a temp root. A witness is written once, when ccd makes the leaf at spawn, and a record is
written once, before a move. So a record that names a device the box no longer has was refused on every pass, for
good, and the lane classes `device` as a fact that does not change by itself.

## What shipped

All of it is in ccd. The server, `shared/` and the PWA are unchanged.

### The proof that a recorded device is gone

`_ws_collect_dev_gone <recorded st_dev> <the temp area's st_dev>` (`ccd/lib/disk-retention.sh`, region `devgone`) is
the one owner of "this device is gone from this box". It reads only, and it answers three ways:

| Answer | Meaning | When |
|---|---|---|
| 0 | proven gone | every condition below holds |
| 1 | still here, or never provable | see the first list below |
| 2 | unmeasured | see the second list below |

It answers 1 when any of these holds:

- the box keeps no mount table (Darwin);
- the number is not 1 to 18 decimal digits;
- the mount table has a line for the device, or the device is of major 0;
- a block-device entry stands for it;
- the block listing does not pass its control (condition 3 below). That is a fact of the box, such as a `/sys` that a
  container hides, not of load, so it keeps today's `device` answer, which the lane lists at once.

It answers 2 when any of these holds:

- the mount table's seam names no table;
- the table cannot be read, is empty or holds a line that is no mount;
- the listing's entry for the device could not be looked at.

Gone means all of:

1. The box keeps a mount table.
2. The mount table has no line for the device. This is the existing `D` request of the identity walk
   (`_ws_reclaim_idwalk`), through the existing seam (`_ws_collect_mountinfo`). The walk is not edited, so the box-move
   release and the rows rung read what they read before.
3. The control: the block-device listing (`/sys/dev/block`, through the new seam `_ws_collect_sysblock`) shows a device
   this box certainly has. That is the device the temp area stands on now. When that device is of major 0, which no
   listing names, it is any block device at all. Without the control, a listing that is missing or is not this box's
   own would read every device as gone. A listing that fails the control answers 1, never 0.
4. The listing has no entry for the recorded device (`_ws_reclaim_absent`, so a dangling link counts as an entry).

Condition 4 is what keeps the safety rule. A volume that is attached but mounted nowhere has no line in the mount
table and still has its block-device entry, so it answers 1 and the refusal stands exactly as before.

Condition 4 assumes that a device of major other than 0 that carries a file system is a block device. The known
exception is UBIFS, whose device number is its UBI volume's character device, listed under `/sys/dev/char`. An
attached, unmounted UBIFS volume therefore reads gone. Its cost is the one a wrong "gone" has (below), and such a
volume is not expected on this product's boxes.

`_ws_collect_devmm` decodes a decimal `st_dev` into `major:minor` in Linux's layout, the spelling both the mount table
and the listing use. It is a second decoder beside the identity walk's (python's `os.major` and `os.minor`), with a
recorded reason: the walk is another process, it decodes only a device it stats or finds in the table, and naming the
listing's entries would need a new request kind in a walk this change does not edit. The bash decoder takes at most 18
digits, which keeps bash's signed 64-bit arithmetic exact; a longer number is never proven gone, the safe direction.
The suite pins the two decoders against each other on Linux.

### The answer the two arms read

`_ws_collect_absence_dev <device> <what carries it>` is the one composer and the owner's only caller.

| ccd answers | When | How the lane treats it (unchanged code) |
|---|---|---|
| the absence is believed | the temp area is on the recorded device | as before |
| the release | another device, and the recorded one is proven gone | see the three cases below |
| unmeasured `device` | owner answer 1, or the temp area's own device cannot be read | per-leaf, listed at once |
| unmeasured `identity` | owner answer 2 | load-sensitive: retried |

`device` keeps the slow schedule it had. A record whose slot does not stand answers `device` too, though its device is
gone (case B below).

The `device` sentence is the one the feed already carries, whole, and the reason the device is not released follows
it in brackets. `identity` is the word the box-move release already answers for the same unreadable mount table, so no
new probe word was added and the lane's tables did not change.

### The three cases

- **A. A witness whose leaf is proven absent, on a gone device.** The audit answers `collectable`, with
  `"recordedDevice":"gone"` in its document. The verb compares and drops the witness, as it does on the same device.
  Nothing is deleted and no quarantine, slot or record is made.
- **B. A quarantine record on a gone device, its slot standing empty, nothing at the path.** The audit answers
  `collectable` with the resume phase `restart`. The verb removes the empty slot (by `rmdir`, never recursively),
  drops the record, keeps the witness, and answers `state-changed`. The next audit takes case A.
- **C. The same record with a directory standing at the path.** The verb does exactly what it does in case B. The
  directory is not touched or read. The next audit takes the fresh arm, where the directory must pass every rung on
  its own identity as measured then: the box-move release's five conditions, owner write, the idle floor, the in-use
  probe, the checkout scan and the row rule. Only then is it collectable, by path, and the verb's own proofs after the
  move still run.

On the same device a record whose slot and path are both empty still resumes as `removed`. `restart` never takes that
order, because `removed` drops the witness on the record's word.

**Only a slot that stands, empty, licenses a restart.** A record whose slot does not stand stays unmeasured `device`,
with the reason after the sentence. A volume that is attached but not active has no block entry, because its
device-mapper or md node exists only while the volume is active: a closed encrypted volume, an inactive logical volume,
or a removed map. Its number therefore reads gone. With the temp area standing on its bare mount point, the slot and the
path read absent as well. A restart there would drop the record of a collection whose leaf waits in its slot on that
volume. When the volume came back, that slot would stand with no record naming it, which is the terminal
`quarantine-kept`, where before the collection resumed by itself. A slot named for that record is made only by that
record's own run, so a slot standing empty in the temp area as it is now shows the record's own storage, copied or
renumbered. The cost of this rule: a record written before its slot was made (a run that stopped between the two)
stays `device` after a box move.

### The token and the proof in the lock

Both tokens gain one input on the release only: `on=<the device the temp area stands on now>`. A same-device token is
byte for byte what it was. The verb recomputes the same evaluation inside the reap lock:

- a block device or a mount of the recorded device that appeared since the audit fails `probe-unmeasured`, and the
  witness, the record and the slot are kept;
- a token minted without the release is refused `state-changed` on the release, and the reverse.

### What the server sees

No server change. The lane's reader takes any word as a resume phase and ignores top-level keys it does not know
(`collect-moved-host-doc.test.ts` now pins both for `restart` and `recordedDevice`). A released id passes the ordinary
licence: the open-run hold, two audits with one token at least a minute apart, then the act. A `restart` act answers
`state-changed`, a retry word, and the id is asked again.

## The design of record, amended

This change narrows two named entries of the child-reclamation design, and amends them in the same change:

- `collect-absence-needs-the-recorded-device` (spec §5.10, both paragraphs, and the contract's entry) now says that a
  mismatch whose recorded device is proven gone is released: a witness by its compare-and-drop, a record whose slot
  stands empty by `restart`. Every other mismatch is refused as before.
- `permanent-device-change-holds-every-absence` (the spec's residual list and the contract's standing residuals) is
  narrowed, not closed. It still stands for a device of major 0 (a tmpfs or btrfs anonymous device), for a number
  another device took, for a record whose slot does not stand, and for a box whose block listing fails its control.
  It stays in the path-identity design's standing §3.7 set and in `path-identity-w2-prose.test.ts`'s
  `BASE_RESIDUALS`.

## Where this departs from the direction as worded

The direction said the collector should start over with "a FRESH witness on the current device". No witness file is
written, and this is a stated conflict, not a silent one.

- The witness has one writer (`_ws_tmproot_witness_write`), called only when ccd makes a leaf at spawn. A second caller
  inside the collector would be a second writer of that fact, and the box-move release was ruled on those terms
  ("nothing is written: the witness keeps its one writer").
- In case A there is no leaf to witness. Starting over can only mean believing the absence on the current device.
- In cases B and C the old witness is kept as it stands. The identity the collection then binds is fresh and is the
  directory's own on the current device: the token carries its device, inode and birth time, and the quarantine record
  the verb writes before its move carries them too (`leaf=`). What is not rewritten is the file under `tmproots/`.

So "the same proofs as any orphan, with no shortcut" holds, and "deleting on the strength of the old record" does not
happen. If a literally new witness file is wanted, it is a follow-up: it must go through the one writer, which
overwrites, so the old fields would survive only in the journal.

## Device numbers that change on a reboot

Some storage (a device mapper, a software RAID) can number the same file system differently after a reboot. Old
records carry only the number. For them:

- **The old number is now free.** The record reads gone, and the absence is believed on the device the temp area
  stands on now. That is the same file system, so the answer is correct.
- **Another live device took the old number, or the number is of major 0.** The answer stays `device`, and the
  reason shows on the feed. A number alone cannot tell this from a shadowed mount.
- **The old number is free, but the volume can come back, and the temp area is its bare mount point.** "Gone" is
  wrong here. The volume is detached whole, or attached but not active (a device-mapper or md node that exists only
  while the volume is active, as above). Its cost is a dropped witness, never a removal and never a record, because a
  record restarts only beside its own standing slot. Two things follow when the volume returns. The witness's leaf
  stands unwitnessed, and is left to the loose arm's own proofs (a 48-hour floor and two observations). A quarantine
  slot on that volume that no record names, which the operator was shown as `quarantine-kept`, leaves every listing.
  The absent arm lists slots in the temp area as it stands now, and the loose census skips the quarantine. Its bytes
  then stay until the operator looks. Neither is a deletion; the stable identity (follow-up 1) removes the false gone.

A stabler identity beside the number in NEW witnesses and records is the cure, and it is a follow-up (below).

## What this will not do

- **It may heal nothing on the measured fleet until one fact is checked.** If the old device number exists as any
  block device on the new box, or is of major 0, every record stays refused. Two machines of one provider often number
  their disks alike.
- **It frees little disk.** A `device` answer worded "the witness of …" is raised only when the leaf is proven absent,
  so those ids hold no bytes; healing them clears bookkeeping and console lines. Only a `device` answer worded "the
  quarantine record …" with a directory standing at the path holds data.
- **A box whose block listing is not its own** (a container that hides it) answers `device` for these ids, as before,
  with the failed control as the reason. It never heals there.
- **A record with no witness beside it** (a run that died after it dropped the witness) is restarted like any other,
  when its slot stands.
  The id then has neither a witness nor a record, so it leaves the collector's population, as it does when the same
  record finishes as `removed`. A directory left at the path is then a loose entry, which the loose arm judges.
- **The verb's failure line is cut at 300 bytes**, so on a long path it carries the device sentence and not the whole
  reason. The audit's document carries both.

## The read-only check, for the operator

Nothing here is run by a session, and nothing is deleted by hand.

1. In the feed, take the recorded device number from a `device` answer ("not on device N that … carries") and decode
   it as Linux does for the numbers disks have: major is `(N >> 8) & 0xfff`, minor is
   `(N & 0xff) | ((N >> 12) & 0xffffff00)`.
2. On the fleet box, list the block devices with their numbers and the mount table. If that `major:minor` appears in
   either, or the major is 0, those ids stay refused, by design.
3. Count which `device` answers name a quarantine record and which name a witness. Only the first can hold a
   directory.

## Left out, and why

- **`containment-unproven` from a git directory path that no longer exists.** It is a present fact about whose tree
  this is, not a stale record. The scratch-rescue act adds attic refs for a session's scratch repository and needs a
  live registry row and a full repository; a linked worktree whose admin directory is gone is neither. It needs its
  own design and a ruling on what must be proved before such a tree is taken.
- **A slot leaf that a move of the box copied** (`quarantine-kept` in the resume). Same root cause, but a present
  directory in a slot needs its own conditions, as the box-move release has for a leaf at the path.
- **`registered` from a standing child marker, and the one `quarantine-kept` after a failed removal.** Different
  causes.
- **The reclaim and expiry tail's witness drop.** Unchanged; a witness it keeps is healed by the collector's absent
  arm on a later pass.
- **The box-move release's mount check and the rows rung's rule for a recorded entry.** Both read the mount table
  alone, so an attached but unmounted volume reads as absent there. Moving them onto the block-listing check changes
  two ruled features and needs its own ruling.

## Follow-ups

1. A stabler identity beside the device number in new witnesses and records. Both parsers are anchored at the end of
   the line, so an older ccd reads a new field as malformed, which is terminal on a rollback. It must be a sidecar an
   older ccd ignores, or ship reader first. Candidate shapes: a marker in the temp area that names it, with a ledger
   under the registry keyed by device number; or an optional file-system id field.
2. A design for `containment-unproven` from a git directory that is gone.
3. A release for a slot leaf copied by a move of the box.
4. Registry residue that keeps an id `registered` with no session.
5. A ruling on the two mount-table-only checks named above.

## The departure, for the ledger

`D-8948` — the temp-root collector's device rule gains one release. An absence is still
believed only on the device the witness or the quarantine record carries, except when that device is proven gone from
the box (no mount, no block device, and a block listing proven to be the box's own). Then a witness whose leaf is
absent is compared and dropped, and a record whose slot stands empty is restarted (`restart`: the slot and the record
cleared, the witness kept). No tree is removed on the old record, no witness is written, and a device still on the box
keeps the refusal. A block listing that fails its control keeps `device`. Tokens bind the release (`on=`). It narrows
`collect-absence-needs-the-recorded-device` and `permanent-device-change-holds-every-absence`, both amended in the
design of record. ccd only; the program grows by 40 net code lines (`ccd/ccd` by 2, `ccd/lib/disk-retention.sh` by
38), at the per-PR limit of 40.

## Tests

New: `server/test/ccd-collect-device-gone.test.ts`. Fixture HOMEs only; the mount table is a copy at a seam, the block
listing a directory of links at a seam, and nothing is mounted.

- Characterization, written first and green on `main`: the same-device tokens of both arms, input for input; a record
  with an empty slot and another directory at the path still resumes as `removed`; a device of major 0 still answers
  `device` in the old sentence.
- The decode against Linux's `makedev`, a minor above 255 and a major above 4095 included.
- The owner's three answers, the mount table answered by a stub: the unmounted-volume rule, the control, every
  unmeasured arm, and Darwin asking neither seam.
- The evaluation with the owner answered by a stub: the release's tokens, the `restart` phase, a slot that does not
  stand keeping `device`, both unmeasured words, the recordless slot still terminal, the pause, and the document's
  keys. Off Linux a shell function answers the one GNU `find -printf` listing of a standing slot.
- End to end, Linux only: the safety rule, the unmeasured arms, cases A, B and C, and the proof in the lock.

Each guard was removed in turn and the suite measured red, on a laptop where the end-to-end cases do not run, so
"red" below is the count in the cases that run on every platform:

| Guard removed | Cases that went red |
|---|---|
| the block-entry check (condition 4) | 2: the unmounted-volume rule, a link and a directory |
| a mounted device read as absent | 1 |
| a device of major 0 read as absent | 1 |
| an unreadable, empty or malformed table read as absent | 4 |
| the control (condition 3) | 5: no listing, a file, no temp-area entry, both control cases |
| the control's failure read as 2 (unmeasured) | 6 |
| the restart granted on a slot that does not stand | 2 |
| the Darwin guard | 1 |
| the number check | 3 |
| the composer folding "unmeasured" into the release | 3 |
| the composer folding "still here" into the release | 5 |
| `on=` dropped from the absent arm's token | 1 |
| `on=` dropped from the resume's token | 2 |
| `restart` folded into `removed` | 3 |
| the `recordedDevice` key | 2 |
| the release itself | 8 |
| the owner asked on the same device | 5, the characterization among them |

Changed: the two whole-sentence pins of the `device` answer (`ccd-collect-audit-rungs.test.ts`,
`ccd-collect-audit-resume.test.ts`) gain the bracketed reason; `collect-moved-host-doc.test.ts` gains the twins that
show the server reads the new phase and key unchanged; `ccd-rows-rung-identity.test.ts`'s census of the mount table's
readers names a fourth, through the same seam and the same parser, and pins that the proof has one caller;
`wsCollectFixture.ts` gains the block listing's seam.
