# Reader Mode follow-up (ticket x6-fu-sheet-focus), task note for the ledger

Run 4076, wave 59, the native Docs reader programme. The plan is `docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`; the full
record of this wave is that plan's Results section "Follow-up wave, ticket x6-fu-sheet-focus". Built on `main` at `7d2c9aecb3`, where
wave XR (#3479) landed. This note is what the ledger should learn.

## What shipped

- **The held console is given back when the last dialog over it closes, the palette included** (review 4052 A1). After reader mode
  ended under an open Docs sheet, a sheet that unmounted under the open command palette (its "Go to" path under reduced motion) left
  the console hidden from assistive technology, and the next reader mode made that permanent. The palette's close and unmount now
  give a held node back once no open dialog stands, and the next reader mode adopts a node still held, so its release gives it back.
  While reader mode is never used the held set is empty and every sheet and the palette behave as on `main`.
- **Focus after a fall back that follows an entry lands on the main region** (review 4052 F1), never on a head action the next
  commit unmounts. The head's action counts only while reader mode's own offer stands after the exit; with no frame standing that
  offer is off, so a frameless exit always sends focus to the main region.
- **Two browser rows made steady, both cures in the rows.** The reader frame's phone-born focus rows wait for the one bar before they
  read its class (#3558: the head's swap commits after the reader's ready, measured). The appearance row AP-3 measures only with its
  frame hook in place before the frame's scripts, and opens again when the hook landed late (#3553: the library's bootstrap keeps the
  method the hook patches as it starts; the reader frame is an out-of-process frame; measured on time, inferred late in the issue).
- **The record of review 4052** corrected in the plan and the design (A2, A4, A5, A6, and the sentences F1 and A1 contradicted).

## Commits, in order

| Commit | Item |
|---|---|
| `02f18da324` | item 4, #3558: the phone-born focus rows wait for the one bar |
| `ba7b6c6e15` | item 5, #3553: AP-3 measures only with its frame hook in time |
| `80ff0a6bdb` | item 2, review 4052 F1: focus after a fall back that follows an entry |
| `fd29163fd4` | item 1, review 4052 A1: the palette lifts what reader mode held; the next reader mode adopts a leftover |
| (next) | items 3 and 6: the records (the plan, the design, one test comment, this note) |

## Deviation numbers

The run was issued 9156 and 9157. Neither is defined; both are returned unused.

## For the coordinator to rule

- With no frame standing the head-action branch of the exit's focus is now never taken. It is kept so delivery reads as the L1 rule
  states it. Deleting it, with its L1 arm, its policy rows and the design clause, is a small follow-up if wanted.

## Carried, not built

- In reader mode, Back, a new version, Forward and Exit: the next Back does nothing. Still not in reach of a small change: the record
  cannot learn which entries a router push discarded (wave PH's history rule).
- A flag for a re-entry while an exit is in flight: now looks in reach of a small change, about 30 to 40 lines: a fact the hook
  keeps itself (no new port member), set by its own step-back, cleared at that landing or at a bound, with the refusal decided in L1
  (`readerModeOffered`). Not built, as the brief said.

## Stated residues

- Wave XR's note (`wave-xr-reader-mode.md`) says, under its stated residues, that the palette lifts nothing and that a node held
  under it stays hidden until the next sheet unmount or the next reader mode. This wave supersedes that bullet: the palette's close
  and unmount now give the node back, and the next reader mode adopts one still held (that note is left as merged).
- Review 4043's second residue (a sheet in the reading container reopened during its exit after another layer came and went) is not
  cured by adoption, and is not reachable as built.
- An open Radix popover holds the lift back but never lifts on its own close, as on `main`; the next reader mode's adoption cures it.

## Not measured here

A real browser for the palette's lift (jsdom only; no browser row drives a sheet unmounting under the palette). Firefox, phones and
real devices, as before.
