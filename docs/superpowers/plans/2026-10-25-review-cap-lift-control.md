# The console lifts the review-round cap: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One wave,
> one PR. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an operator who gets the review-cap notice can see the cap's state in the console and lift it from there,
through the session-gated route that already exists.

**Architecture:** the server adds the cap's state to every run row, and one read that composes the ask the refusal
already composes. The PWA adds one reader of that state, one confirm sheet, a "waiting on you" band on the run board,
and a door on the cap's record in Mail. The lift route and the cap's rule stay exactly as #1331 shipped them.

**Tech stack:** TypeScript, Fastify, `node:sqlite` (server); React, the `@ccrc/ui` kit, vitest + jsdom (PWA).

**Spec:** GitHub issue #1410, and D-6795 in `docs/superpowers/plans/2026-10-24-build-spend-controls.md`,
the cap it builds on. Anchors are `≈:` hints into `origin/main` at `c7e81adfe`, 2026-10-25. Re-ground each one by
its symbol before editing.

## What was measured (2026-10-25)

- **The cap.** `REVIEW_ROUND_CAP = 3` (`server/src/coord/reviewcap.ts` ≈:14). `CoordStore.openRun` refuses a fourth
  review run for one work run with `cap-review-rounds`, unless `review_cap.liftedAt` is set for it (`store.ts` ≈:1848).
- **The ask.** The refusal arm in `POST /api/runs` (`routes.ts` ≈:1541-1557) composes `reviewCapAsk(work, rounds, last,
  reviewFindingsOf(read))`, where `last` is `coord.lastReviewReport(work)` and `read` is
  `deps.io.readFileMeasured(last.report, 5000)`. `raiseReviewCapAsk` stamps `askedAt` exactly once, and the notice is
  `{ kind: 'run', sessionId: '', runId: work }`. It is the only `kind: 'run'` notice written with a literal `''`
  session (`git grep "kind: 'run', sessionId: ''" -- server/src` names that one line).
- **The lift.** `POST /api/coord/review-cap` with `{ run }` (`routes.ts` ≈:2166-2182) is session-gated with no box token,
  idempotent, 404 for a run that is not a work run, 400 for a bad id. It answers `{ ok, run, rounds, cap, lifted }`.
  `coord-pause-route.test.ts`'s `SESSION_ONLY` holds it.
- **What nobody reads.** `pwa/src` has no caller of `/api/coord/review-cap`. No route or frame carries `review_cap`'s
  `askedAt`/`liftedAt` or `reviewRounds()`. The ask's types (`LastReviewReport`, `ReviewFindings`, `ReviewCapAsk`) live
  in `server/src/coord/reviewcap.ts`, where the PWA cannot import them.
- **The patterns to follow.** `RunSummary.childReclaim` (`shared/api.ts` ≈:6590-6611) is a field that is required on the
  server type and optional at the PWA's one reader, because a `RunSummary` is cast, never revived. `hydrateRun`
  (`store.ts` ≈:4363) takes batch-measured `health` as a required parameter rather than run per-row reads (D-1299).
  `AbandonSheet` (`pwa/src/fleet/AbandonSheet.tsx`) is the confirm-in-page sheet, and `RunsScreen` holds one sheet at
  screen level (`abandonTarget`, ≈:114).
- **Growth limits.** `server/src/coord/store.ts`, `server/src/coord/routes.ts` and `pwa/src/lib/api.ts` are growth-checked
  at 40 net code lines each (`server/test/growthCheck.ts` `GROWTH_LIMIT`). Logic goes in `reviewcap.ts` and in new PWA
  files, so those three stay under the limit.
- **A claim.** `pwa/src/screens/RunRow.tsx` is under another wave's live claim. This wave does not edit it.

## The decisions

- **D-6909: the cap's state rides every run row.** `RunSummary` gains `reviewCap: ReviewCapStatus | null`. A work run
  carries `{ rounds, cap, askedAt, liftedAt }`; a review run, or a run of unknown kind, carries `null`. It is filled in
  `hydrateRun` from one batch read, so `GET /api/runs`, the `runs` WS frame and the advance echo all carry it. It is
  required on the server type, as `health` is, and optional at the PWA's one reader. An older server omits it, and that
  reads as "not measured", which is never "not waiting". `FLEET_PROTO` is not bumped.
- **D-6910: one read of the ask.** `GET /api/coord/review-cap/:id` answers `{ ok: true, ask: ReviewCapAsk, askedAt,
  liftedAt }` for a work run. It is session-gated with no box token, like the lift: the refusal already hands a
  coordinator its ask, and this read is for the operator's sheet. The refusal arm and this route compose the ask
  through ONE helper, so the sheet shows exactly what the notice said. The three ask types move to `shared/api.ts`, so
  the PWA can read them. They are moved, not copied (`single-definition.test.ts`).
- **D-6911: where the control lives.**
  - A **"Waiting on you" band** on the run board, above the groups, lists every open work run whose ask is raised. A
    run not yet lifted gets a Lift cap button; a lifted run says when it was lifted, until the run closes.
  - A **Lift cap door** on the cap's record in Mail. The record matches when it is `kind === 'run'`, its `sessionId` is
    `''`, and it names a run whose ask is raised and not lifted. A server test pins that the cap's notice is the one
    writer of that shape.
  - **One sheet** serves both: `LiftCapSheet`. It reads the ask when it opens, shows it, and posts `{ run }` only after
    the operator confirms in the page.
  - **This departs from #1410's "on the run card".** `RunRow.tsx` is held by another wave, and the band sits on the same
    board as the card. A later wave may move the door onto the card.
- **D-6912: spare.** Spend it only on a departure found while executing. If unused, its entry says "spare, unused".
- **Not built: the optional CLI path from #1410.** A `ccrc` verb on a box holds no operator session, and it must never
  use the box token (D-6795's rule that no machine lane lifts its own cap). It stays on #1410 as a follow-up.

## Global constraints

- No change to `REVIEW_ROUND_CAP`, `reviewCapRefuses`, the lift route's auth, body or answer, or the refusal's code and
  status.
- The box token never reaches either cap route. Both stay out of every EXEMPT table, and `SESSION_ONLY` still holds the
  POST.
- `ccd/coordinator-skill`, `ccd/worker-skill` and `ccd/reviewer-skill` never name the review-cap door
  (`coordinator-skill.test.ts` ≈:1742). This wave touches no skill text.
- Wire discipline: additive only. One reader per new field, in `pwa/src/fleet/reviewCapWords.ts`.
- The three growth-checked files stay at or under +40 net code lines each.
- Fixture HOMEs only. No test reads a live coord.db, a live report, or the live box.
- Copy is the console's own idiom: sentence case and plain words, no raw state tokens, and no path or host printed
  except the report path the ask already carries.

## Review focus

1. **An older server.** `reviewCap` is absent: the band and the Mail door render nothing for that run and the board
   still renders. Pinned in Task 3 (`reviewCapOf` on `undefined`).
2. **A lift that races a second tab.** The POST is idempotent: a second lift answers 200 and the sheet closes cleanly.
   Pinned in Task 3.
3. **The ask's report is gone or unreadable.** The sheet says so in words (the findings state `absent`, `unreadable` or
   `unnamed`), never blank. Pinned in Task 3.
4. **A closed run.** A run that closed after its ask was raised is never "waiting": no band entry, no Mail door. Pinned
   in Task 4.
5. **A response that lands after the sheet moved to another run.** The superseded answer neither renders nor closes the
   sheet (`AbandonSheet`'s guard). Pinned in Task 3.

---

### Task 1: the cap's state on every run row (D-6909)

**Files:**
- Modify: `shared/api.ts` (`ReviewCapStatus`, and `RunSummary.reviewCap` beside `childReclaim`)
- Modify: `server/src/coord/reviewcap.ts` (`reviewCapStatus`, pure)
- Modify: `server/src/coord/store.ts` (`reviewCapStates`; `hydrateRun` and its callers)
- Test: `server/test/review-cap.test.ts`, `server/test/run-routes.test.ts` (the existing lift describe ≈:4256)

**Interfaces:**
- Produces `export interface ReviewCapStatus { rounds: number; cap: number; askedAt: number | null; liftedAt: number | null }`
  in `shared/api.ts`, and `RunSummary.reviewCap: ReviewCapStatus | null`.
- Produces `reviewCapStatus(kind: RunKind, rounds: number, row: { askedAt: number | null; liftedAt: number | null } | undefined): ReviewCapStatus | null`
  in `reviewcap.ts`, with `null` unless `kind === 'work'`.
- Produces `CoordStore.reviewCapStates(ids: readonly number[]): Map<number, { rounds: number; askedAt: number | null; liftedAt: number | null }>`,
  in two statements for the whole batch: review-run counts grouped by `reviews`, and the `review_cap` rows.

- [ ] **Step 1: Write the failing tests.**
  - `review-cap.test.ts`, "reviewCapStatus":
    - a work run with no `review_cap` row gives `{ rounds, cap: 3, askedAt: null, liftedAt: null }`;
    - a review run gives `null`, and so does an unknown kind.
  - `run-routes.test.ts`, "GET /api/runs carries the cap's state":
    - a work run with three review runs reads `reviewCap` `{ rounds: 3, cap: 3, askedAt: null, liftedAt: null }`;
    - after a refused fourth open, `askedAt` is a number and `liftedAt` is still `null`;
    - after `POST /api/coord/review-cap`, `liftedAt` is a number;
    - each review run's `reviewCap` is `null`;
    - `coord.runs()`'s rows, which the `runs` frame ships, carry the same object.
- [ ] **Step 2: Run them and see them fail.** From `server/`: `./node_modules/.bin/vitest run test/review-cap.test.ts`,
  then the run-routes describe with `-t "carries the cap's state"`. Both fail on the missing field.
- [ ] **Step 3: Implement it.** `hydrateRun` takes the batch's map as a required parameter, as it takes `health`, and
  sets `reviewCap: reviewCapStatus(kind, …)`. The type and the `RunSummary` docstring say "required here, optional at
  the PWA's one reader", in `childReclaim`'s words.
- [ ] **Step 4: Run them and see them pass.** Then run `typecheck-tests`, because every `RunSummary` literal in the tests
  now needs the field.
- [ ] **Step 5: Commit.** `feat(server): every run row carries its review cap's state (D-6909)`

### Task 2: one read of the ask (D-6910)

**Files:**
- Modify: `shared/api.ts`: `LastReviewReport`, `ReviewFindings` and `ReviewCapAsk` move here, and `ReviewCapView` is
  added.
- Modify: `server/src/coord/reviewcap.ts`: import the moved types, re-export nothing, and keep the functions.
- Modify: `server/src/coord/routes.ts`: one helper composes the ask, used by the refusal arm and the new GET.
- Test: `server/test/review-cap.test.ts`, `server/test/run-routes.test.ts`, `server/test/auth-gate.test.ts` (its route
  counts, ≈:275 and ≈:409)

**Interfaces:**
- Produces `export interface ReviewCapView { ok: true; ask: ReviewCapAsk; askedAt: number | null; liftedAt: number | null }`.
- Produces `GET /api/coord/review-cap/:id`:
  - a work run answers 200 with a `ReviewCapView`;
  - a run that is not a work run, or no run at all, answers 404 `not-found`;
  - a bad id answers 400 `bad-request`, read with the file's one canonical id parser (`routes.test.ts`'s id census);
  - with auth armed and no session, it answers 401.
- Produces a helper in `routes.ts`, for example `composeReviewCapAsk(coord, io, work): Promise<ReviewCapAsk>`. It holds
  the four lines the refusal arm has today, and the arm calls it.

- [ ] **Step 1: Write the failing tests.**
  - "GET /api/coord/review-cap/:id answers the refusal's own ask". Refuse a fourth open and keep the 409's `ask`. The GET
    answers 200 with an `ask` deep-equal to it, a numeric `askedAt` and a `null` `liftedAt`. After a lift, `liftedAt`
    is a number.
  - The findings states. With a fixture report under the fixture HOME, `findings.state` is `'read'` and lists its
    `## Findings` bullets. With the report deleted it is `'absent'`. With no report artifact on the mail it is
    `'unnamed'`.
  - The refusals. A review run's id and `999999` answer 404. `0`, `01` and `abc` answer 400.
  - The gate. With `authEnabled`, no cookie answers 401, and the box token alone also answers 401.
  - "the cap notice is the one `kind: 'run'` record with no session". A text scan of `server/src` finds exactly one
    `kind: 'run', sessionId: ''` writer, and it is in the refusal arm. The PWA's Mail door relies on that match.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.** Move the types, extract the helper, then add the route beside the POST. Update
  `auth-gate.test.ts`'s counted lists for one more gated route. Each count's comment names this route and D-6910.
- [ ] **Step 4: Run them and see them pass,** then `single-definition`, `coord-pause-route`, `box-token-census`, `rings`
  (if present) and `typecheck-tests`.
- [ ] **Step 5: Commit.** `feat(server): the operator reads a review cap's ask before lifting it (D-6910)`

### Task 3: the PWA reader, the calls and the sheet (D-6911)

**Files:**
- Modify: `pwa/src/lib/api.ts`. Add `reviewCap(run: number): Promise<ReviewCapView>` (GET) and
  `liftReviewCap(run: number): Promise<{ ok: true; run: number; rounds: number; cap: number; lifted: true }>`, a POST
  of exactly `{ run }`. Each takes its URL and method once and has a pin in `api.test.ts`.
- Create: `pwa/src/fleet/reviewCapWords.ts`.
- Create: `pwa/src/fleet/LiftCapSheet.tsx`.
- Test: `pwa/test/api.test.ts`, `pwa/test/review-cap-words.test.ts`, `pwa/test/lift-cap-sheet.test.tsx`.

**Interfaces:**
- Produces `reviewCapOf(run: { reviewCap?: ReviewCapStatus | null }): ReviewCapStatus | 'unmeasured' | null`.
  It is the ONE reader of `RunSummary.reviewCap`: `undefined` answers `'unmeasured'`, `null` answers `null`.
- Produces `capWaiting(run: RunSummary): 'waiting' | 'lifted' | null`. A closed run (`isRunClosed`) answers `null`. A
  raised ask with no lift answers `'waiting'`, a raised ask that was lifted answers `'lifted'`, and anything else,
  `'unmeasured'` included, answers `null`.
- Produces `findingsWords(f: ReviewFindings): string[]`:
  - `read` with lines gives the lines;
  - `read` with none gives `['The report lists no open findings.']`;
  - `absent` gives `['The report file is gone.']`;
  - `unreadable` gives `['The report file could not be read.']`;
  - `unnamed` gives `['No report is on file.']`.

  The first four are the same words `reviewCapNotice` uses.
- Produces `LiftCapSheet({ run, onClose, onDone, loadAsk = api.reviewCap, lift = api.liftReviewCap })`, where `run` is a
  `RunSummary | null` and the sheet is open while it is not null.

- [ ] **Step 1: Write the failing tests.**
  - `review-cap-words.test.ts`:
    - `reviewCapOf` answers each of the three cases;
    - `capWaiting` answers each of its cases, including a closed run with a raised, unlifted ask (`null`);
    - `findingsWords` answers all five cases.
  - `lift-cap-sheet.test.tsx`:
    - On open, `loadAsk` is called once with the run id. The sheet shows "3 of 3 review rounds", the last review's run id
      and summary, and the findings lines.
    - Lift cap calls `lift` exactly once with the run id, then `onDone` and `onClose`.
    - Cancel calls neither.
    - A 404 or 400 `ApiError` from `lift` renders words in the sheet, and the sheet stays open.
    - A failed `loadAsk` says the ask could not be read, and Lift cap is still offered: the lift does not need the ask.
    - A second lift answering 200 closes the sheet cleanly.
    - The sheet switches to another run while `loadAsk` is in flight. The old answer neither renders nor closes it.
  - `api.test.ts`: both calls' URL, method and body.
- [ ] **Step 2: Run them and see them fail.** From `pwa/`: `./node_modules/.bin/vitest run test/review-cap-words.test.ts test/lift-cap-sheet.test.tsx test/api.test.ts`.
- [ ] **Step 3: Implement it.** Build the sheet on `AbandonSheet`'s shape: `Sheet` and `Button` from `@ccrc/ui`, one
  busy flag, errors in words, and the superseded-response guard. Style it with the existing tokens in `fleet.css`. Add
  no new colour.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(pwa): a sheet that shows a review cap's ask and lifts it (D-6911)`

### Task 4: the board's band and the Mail door (D-6911)

**Files:**
- Create: `pwa/src/fleet/ReviewCapBand.tsx`.
- Modify: `pwa/src/screens/RunsScreen.tsx`. Render the band above the groups, and hold one `liftTarget` with one
  `LiftCapSheet`, on `abandonTarget`'s idiom. `onDone` re-reads the cold runs.
- Modify: `pwa/src/screens/MailScreen.tsx`. On a record that matches D-6911, add a Lift cap door that opens the screen's
  one `LiftCapSheet`. `onDone` re-reads the runs.
- Test: `pwa/test/review-cap-band.test.tsx`, `pwa/test/runs-screen.test.tsx`, `pwa/test/mail-screen.test.tsx`.

**Interfaces:**
- Consumes `capWaiting`, `reviewCapOf` and `LiftCapSheet` from Task 3.
- Produces `ReviewCapBand({ runs, nowMs, onLift }: { runs: readonly RunSummary[]; nowMs: number; onLift: (run: RunSummary) => void })`.
  It renders nothing when no run is waiting or lifted. Its heading is "Waiting on you". A waiting row reads
  "Run 12 · <programTitle> wave 2: review cap reached, 3 of 3 rounds", followed by the Lift cap button. A lifted row
  reads "Run 12: review cap lifted 5m ago", with the age from `formatAge`.

- [ ] **Step 1: Write the failing tests.**
  - `review-cap-band.test.tsx`:
    - one waiting run, one lifted run, one closed run with a raised ask, a review run, and a work run with no
      `reviewCap` field: only the first two render;
    - the button calls `onLift` with the run;
    - with no entries, the band renders nothing.
  - `runs-screen.test.tsx`: the band appears above the groups for a waiting run, and its button opens the sheet.
  - `mail-screen.test.tsx`:
    - the door shows on a `kind: 'run'` record with `sessionId: ''` that names a waiting run;
    - there is no door on a `kind: 'run'` record that names a session, none once the run is lifted, none on a closed
      run, and none when `reviewCap` is absent.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them and see them pass.** Then run the whole PWA suite in the foreground (`npm run test`) and
  `npm run build`.
- [ ] **Step 5: Commit.** `feat(pwa): the run board and Mail offer the review cap's lift (D-6911)`

### Task 5: mutation table, gates, plan and PR

- [ ] **Step 1: The mutation table.** Each mutant runs on a scratch copy, is restored byte-identical (checked by `cmp`),
  and has its ending recorded:
  - M1: `hydrateRun` sets `reviewCap: null` on every row. The "carries the cap's state" rows go red.
  - M2: `capWaiting` drops its `liftedAt === null` test. The lifted band row and the Mail "not once lifted" row go red.
  - M3: `capWaiting` drops its closed-run test. The closed-run band row and Mail row go red.
  - M4: the Mail door drops its `sessionId === ''` clause. The "record that names a session" row goes red.
  - M5: the sheet posts on open instead of on confirm. The Cancel row goes red.
  - M6: the GET composes its own ask instead of calling the helper, with its findings left `unnamed`. The deep-equal row
    goes red.
- [ ] **Step 2: Gates.** From `server/`, one file at a time, in the foreground, with `--pool=forks --maxWorkers=2`:
  `review-cap`, `run-routes`, `auth-gate`, `coord-pause-route`, `box-token-census`, `coordinator-skill`,
  `single-definition`, `growth-check`, `docs-parity`, `citations`, `topology-clean`, `private-names`, `dtbd`,
  `typecheck-tests`, and `deviation-refs` after `git fetch origin main`. From `pwa/`: the whole suite, then
  `npm run build`.
- [ ] **Step 3: The plan's As built note,** at the end of this file. Record what each deviation became, the mutation
  table's endings, the measured growth of the three growth-checked files, and D-6912's state.
- [ ] **Step 4: The PR,** from the workspace branch:
  - its body names #1410 and #1331, and links this plan by its GitHub blob URL;
  - it names no host, path or session;
  - check that the PR's `select tests` summary lists the touched server suites.

## Deviations found

- **D-6909.** `RunSummary.reviewCap`: a work run's review rounds, the cap, and when its ask was raised and lifted. It is
  batch-read in `hydrateRun`, so every run emitter carries it. Required on the server type, optional at the PWA's one
  reader (`reviewCapOf`), and an absent field reads as unmeasured.
- **D-6910.** `GET /api/coord/review-cap/:id`, session-gated with no box token, answers the ask through the same helper
  as the `cap-review-rounds` refusal, with `askedAt` and `liftedAt`. The ask's three types move to `shared/api.ts`.
- **D-6911.** The lift's door is a "Waiting on you" band on the run board, plus a door on the cap's record in Mail. It is
  not on the run card, which #1410 asked for, because `RunRow.tsx` is under another wave's claim. One `LiftCapSheet`
  serves both doors and posts only on confirm. The Mail record matches on `kind: 'run'`, `sessionId: ''` and a waiting
  ask. A server scan pins that the cap's notice is that shape's one writer.
- **D-6912.** Spare, for a departure found while executing. If unused, it says "spare, unused".
