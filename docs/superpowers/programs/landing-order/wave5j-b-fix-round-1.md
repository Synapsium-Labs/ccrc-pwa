# Wave 5j-b, fix round 1: review run 3864's six minor findings, as ruled

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`. Review run 3864 read tip `511f196a96` and found
nothing critical or important; the coordinator ruled its six minor findings (call 1324). This round's code and tests are
commit `8bd7829337`; the notes and the plan edit follow it. Every hash and count below names `8bd7829337`.

## The rulings

- **R1 (F6, D-9093): one copy, not a mirror.** `server/src/coord/landingWrites.ts` imports `LANDING_ENTRY_TERMINAL` from
  `shared/landingLine.ts`; `TERMINAL_WORD` and its comment are deleted, and `isTerminalWord` reads the shared map. The
  header says the one value import it takes. In `landing-writes.test.ts` the purity case is narrowed to "no value import
  except the shared landing vocabulary" (the one specifier, `../../../shared/landingLine.js`, spelled exactly) and
  retitled; the clock, fs and builtin scans are unchanged. Its CONTROL gains two lines: with the shared import present the
  scan still sees a sibling value import (`./store.js`), and a different spelling of the shared file is not admitted. The
  case over every state is kept and retitled; it now pins the arm. D-9093's definition in the plan is rewritten to say this
  (slug kept).
  - Red then green: with the source changed and the old assertion (`valueImports(p)` is `[]`) restored, the purity case is
    red (row R1-RED below); with the narrowed assertion, green.
- **R2 (F5): `landing_intents` is diffed.** `landing-subtractive.test.ts` lists seven tables, `landing_intents` among them
  (keyed by `runId` and `key`), for the withdraw diff and the pause diff, with no change allowed in it. The fixture opens
  one run of the project and seeds one hold row, and each case asserts the row is there before it diffs, so an empty table
  cannot pass for an unchanged one.
  - Red: row B35 (the withdraw apply arm also writes a `landing_intents` row) turns all twelve withdraw cases red.
- **R3 (F4): the strict read of the stored pin time has a red case.** A new case in `landing-journal-store.test.ts`, over a
  real store: entry A's stored `pinnedAt` is set to text, a withdraw with `pinnedAt: 0` answers `landing-entry-moved`, the
  journal's bytes are unchanged, the entry stays `pinned` and no mail is queued. B16 stays as it was.
  - Red: row B36 (`safeIntOf(m.row.pinnedAt, 0) ?? 0`, the read folded to 0) turns the case red.
- **R4 (F3): the two writer-only words at the route.** The route harness's deps hand the door the real store; the new case
  spies that store's `writeLandingAuthority` (`vi.spyOn`) to answer each word, and posts to both doors:
  `landing-record-unparseable` answers 500 and `landing-sequence-overflow` 409, each with its word, nothing more. No seam
  was added to source.
  - These pin behaviour that was already right, so there is no red-then-green of the source. Its teeth: row R4-TEETH
    (`landing-record-unparseable` mapped to 503 in `shared/refusal.ts`) turns the case red.
- **R5 (F1):** the Task 10 note now says its hashes and suite counts name `b4ed8c2cb9`, and that the two merges of main and
  the D-9093 comment edit changed four of the mutated files since. Nothing re-hashed.
- **R6 (F2):** the Task 9 note's absolute totals now read 324 to 326 routes and 321 to 323 HTTP, at the tip over main
  `5b14086b57`, with the first base's figures named as such. The plus two and the 78 to 80 stand.

## The rows

Each row was applied as one exact-text change to the named file, the named suite run filtered by `-t` from `server/`,
and the file restored from its saved copy with its sha256 checked equal, inside one `ccrc test` slot.

| Row | Change | File (sha256 of the saved copy) | Red |
| --- | --- | --- | --- |
| R1-RED | the purity case's old assertion, `valueImports(p)` is `[]` | `server/test/landing-writes.test.ts` (`ca9572abd6bf9cbf48631edc831264c1a8a83891f2238919bcbc2a177a61d9f6`) | `landing-writes` -t `pure L1`: 1 failed, 1 passed, 103 skipped (105) |
| B34 | a value import of the store, `import { CoordStore } from './store.js'` | `server/src/coord/landingWrites.ts` (`bc2434db547e7502a00c7915e8109f9b14a6485457bc98113dce25607d1022b4`) | `landing-writes` -t `pure L1`: 1 failed, 1 passed, 103 skipped (105) |
| B35 | the withdraw apply arm also inserts a `landing_intents` row | `server/src/coord/store.ts` (`fe1441251e5072a3ff0a593f1ff2e5482b84bd214346575e9a0f4a6368e27b68`) | `landing-subtractive` -t `withdraw door is subtractive`: 12 failed, 12 skipped (24) |
| B36 | the stored pin time's read folded to 0 | `server/src/coord/landingEntry.ts` (`0071216e0c3e5e13c02bcf1093d1b9f1ce2810e9f960cf19c2fd8ffc52667e1a`) | `landing-journal-store` -t `never 0`: 1 failed, 90 skipped (91) |
| R4-TEETH | `landing-record-unparseable` mapped to 503 | `shared/refusal.ts` (`76fea812a7a36284ea65574ed74f3c119e4f76ef75f30d67e9bcceadc26a6c6c`) | `landing-doors-route` -t `writer`: 1 failed, 1 passed, 13 skipped (15) |

All five red, every file restored equal.

## Green

At `8bd7829337`, one file per process: `landing-writes` 105, `landing-subtractive` 24, `landing-journal-store` 91,
`landing-doors-route` 15; the scoped typecheck over the server and the landing and census test files is clean. The
round's full gate is in the wave-done.

## Not in this round

As ruled: the pause event's null run, the withdrawal event's empty session id and the time formatter carry to wave 5k's
plan; an entry with no stored word answering as unrecognised is left (unreachable from the real facts); `CLAUDE.md` and
`README.md` are untouched. No deviation number is defined; D-9093 is rewritten, D-9094 stands.
