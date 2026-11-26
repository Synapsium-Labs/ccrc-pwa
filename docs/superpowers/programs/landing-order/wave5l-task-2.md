# Wave 5l, Task 2: the reader takes a train-closed, unproven entry out of the line (D-9112)

Run 3942, programme `landing-order`, wave 32. Plan sections 4.3, 4.4, 9.2 and 9.3, with section 12's C1, C2 and C8.

## Base and claims

- Built on `main` at `ad52d25f4b`. Every file this task edits is byte for byte the same there as at the plan's baseline
  `f45fce5aee`, so the nine builders of the closed outcome stood where "What was measured" says.
- Claim 7333 holds every file of the task but one. `server/test/mail-routes.test.ts` is held by claim 7280 (run 3866):
  I sent its holder the one-line hunk against `ad52d25f4b` (1 hunk, 1485 bytes, sha256
  `18999805f17c24f1f7dc358798b665465426a41b216f981411ceb24cb1e9cc53`) and changed the file only after its yes (delivery
  37752), which says its own branch changes the file elsewhere and the two hunks do not meet.

## What changed

- `server/src/coord/landingEntry.ts`: `LandingOutcome`'s `closed` arm carries a required `reason` (`'train-unproven'` or
  `null`, a type-only L0 import of `PrReason`); `decideLandingLand` adds `reason` to `detail` only when it is not null, so
  a plain closed mark's detail is byte for byte today's.
- `server/src/coord/landed.ts`: `landedAnswerOf(read, cand)` takes the candidate (required) and closes on ccd's
  `train-unproven` with `train: 'unproven'` for a normal candidate only, with section 4.3's comment as written; its bare
  `closed` arm passes `reason: null`.
- `server/src/coord/landedLane.ts`: one argument, `landedAnswerOf(read, cand)`.
- Tests: R-A to R-G in `landed-decide.test.ts` (the existing calls pass a normal candidate, `{}`; the existing closed
  expectation gains `reason: null`); the store case in `landing-land-store.test.ts` (its four literal sites take
  `reason: null`, its parametric case builds each outcome whole); `landing-land-words.test.ts`' closed-and-absent case
  rebuilt whole, and a case of its own for the reason; one literal in `landing-journal-store.test.ts`; three lane cases in
  `landed-lane.test.ts` (the repair candidate inside the amendment-B `describe`, asserting first from
  `landedProjectStep` that the entry is a repair candidate with a 64-hex token); two binding cases in
  `landing-control.test.ts`; the `NOT_CODES` row in `mail-routes.test.ts`.

## Departure in the store case

The store case reads the journal's bytes before both marks. On `boot`'s fixture, two pins through runs write no journal
record, so `landing.log` did not exist and the read threw `ENOENT`. The case now first creates one no-run entry in
another project (`project-b`), which journals its creation, and asserts the journal is not empty before the marks. The
two marked entries are still the only rows of `project-a`. The plan's case did not name this step.

## Red first

Run before the type, the detail and the answer changed (vitest does not typecheck, so these are run-time reds):

- Red: R-A; the existing "closed and absent close; open waits" (its new `reason: null`); the store case (first
  `ENOENT`, see above; after the fix, its second detail lacked `reason`); `landing-land-words`' reason case; the lane's
  mark case.
- Green on the baseline, as section 4.4's Step 2 predicts: R-B to R-G, the lane's retry and repair-candidate cases, the
  two binding cases, and the rebuilt parametric cases.

## Typecheck

- `npx tsc --noEmit -p tsconfig.json` (the server sources): clean.
- The tests-inclusive typecheck was killed for memory in the local test slice (exit 137, `MemoryMax=6G`), as the brief
  warned. In its place I ran `tsc --noEmit` over a narrow config under the session's temp root that extends the server
  config and names the nine changed test files (they import the sources they test): clean. The pull request's own run is
  the arbiter for the whole tests project.

## Green

Each file alone through `ccrc test`: `landed-decide` 41, `landing-land-store` 65, `landing-land-words` 28,
`landing-journal-store` 91, `landed-lane` 47, `landing-control` 63, `mail-routes` 62, `landing-terminal-damage` 64,
`landing-next-mail` 49, `landing-line-order` 68, `prstate-pr-line` 38, `brief-landed` 12, and the single-definition suite
1617 passed, 1 skipped.

## Mutation rows

Each row: the mutant applied in place by a driver under the session's temp root, the named file run once through `ccrc test` (vitest, `--maxWorkers=2`), every listed case red, then the file's original bytes written back and their sha256 checked equal to the committed file's. No mutant survived.

| id | Mutation | File | Run | Red cases (measured) | Restored sha256 |
|---|---|---|---|---|---|
| M10 | `landedAnswerOf`'s new arm removed | `server/src/coord/landed.ts` | landed-decide.test.ts, landed-lane.test.ts | R-A: train-unproven with its flag closes the entry, the reason carried; train-unproven marks the entry closed, counts it, drops its memory and raises no merged record | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M11 | the arm's test widened to `train-unread` and `unread` | `server/src/coord/landed.ts` | landed-decide.test.ts, landed-lane.test.ts | R-B: train-unread is asked again; train-unread is asked again: the entry stays pinned, nothing is marked, and it is due a doubled step later | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M12 | the arm drops `read.train === 'unproven'` | `server/src/coord/landed.ts` | landed-decide.test.ts | R-C: a train-unproven reason without its flag is asked again | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M13 | `landedAnswerOf`'s `merged` arm answers `close`, `closed` | `server/src/coord/landed.ts` | landed-decide.test.ts | R-E: a merged read lands, its train carried; merged lands with its facts, the train included | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M14 | `landedAnswerOf`'s `open` arm answers `close` | `server/src/coord/landed.ts` | landed-decide.test.ts | R-F: an open read waits; closed and absent close; open waits | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M15 | `landingOrder`'s line filter admits `closed` | `server/src/coord/landingLine.ts` | landing-control.test.ts | after the mark: a closed entry is neither in the line nor outstanding, and the next entry binds | `f0cc587932343750c7a25f5259175c5ea4210f7b0b258cf425aab4024d61048a` |
| M16 | `decideLandingLand` maps a `closed` outcome to state `pinned` | `server/src/coord/landingEntry.ts` | landed-lane.test.ts, landing-land-store.test.ts | a closed answer retires it closed, changing only state and detail; a plain closed and a train-unproven closed both mark closed; only the second detail names the reason; a project with only an unknown-state row is walked, without a session or a pin; a readable row has no repair verdict, and neither has a terminal one; closed and absent mark closed; closed and absent retire it closed; positive control: an ordinary readable closed row does re-pin, and writes its witness; repair, closed, then a verified pin over a BLOB handoff: kept closed, no projection or witness mutation, no metadata invented; repair, closed, then a verified pin over a retained blank setter: kept closed, no projection or witness mutation, no metadata invented; train-unproven marks the entry closed, counts it, drops its memory and raises no merged record | `56158b60eb45ae2f62a50f5d99bac805aa15d72a5e3c698509fefc74fa219b30` |
| M17 | `decideLandingLand` always writes `reason` | `server/src/coord/landingEntry.ts` | landing-land-store.test.ts, landing-land-words.test.ts | a closed answer retires it closed, changing only state and detail; a plain closed and a train-unproven closed both mark closed; only the second detail names the reason; closed and absent mark closed and carry only v, by, at and word | `56158b60eb45ae2f62a50f5d99bac805aa15d72a5e3c698509fefc74fa219b30` |
| M17b | `decideLandingLand` never writes `reason` | `server/src/coord/landingEntry.ts` | landing-land-store.test.ts, landing-land-words.test.ts | a plain closed and a train-unproven closed both mark closed; only the second detail names the reason; a train-unproven close records its reason in the detail (D-9112) | `56158b60eb45ae2f62a50f5d99bac805aa15d72a5e3c698509fefc74fa219b30` |
| M25 | the arm drops `cand.repairToken === undefined` | `server/src/coord/landed.ts` | landed-decide.test.ts | R-G: a terminal-repair candidate is asked again on train-unproven (spec amendment B) | `050e39c8b6df38ef193c825c102ad88978bbefac5d0ef019ba9284764e8f29df` |
| M27 | `landedPass` calls `landedAnswerOf(read, {})` | `server/src/coord/landedLane.ts` | landed-lane.test.ts | a train-unproven answer does not retire a repair candidate: nothing is marked, and it is asked again (spec amendment B, D-9112) | `6296a0a2221254bc5105a517063d334a2e02ebfd22f84e72cb45da43bd962f2f` |
| MJ | (the journal characterization) the land arm also bumps `landing_journal_cursor` | `server/src/coord/store.ts` | landing-land-store.test.ts (`-t train-unproven close is one row`) | a plain closed and a train-unproven closed both mark closed; only the second detail names the reason | `d09b81c2d68d18f560114a00b928850586c7dd36e4fe0b987ed023ba20c7b2f6` |

Against the plan's predictions: every predicted case is red. M16 reds both predicted cases (the lane mark case and the
store case) and eight more that mark an entry closed. MJ stands in for the plan's journal check: rather than a
`landing.log` append, the scratch mutant bumps the journal cursor inside the land arm, and the store case's cursor check
reds; the bytes check had no natural mutant in the store, so it is a characterization pin.
