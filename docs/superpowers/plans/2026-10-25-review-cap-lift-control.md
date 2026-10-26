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
  Spent in fix round 1 on the GET's 503 `run-unreadable` (review 951 F4; see Deviations found).
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
  - a run the store cannot read answers 503 `run-unreadable` (D-6912, found while executing; review 951 F4);
  - with auth armed and no session, it answers 401;
  - its answer carries session-derived text, so it is masked by the one answer hook (`MASKED_GET_ROUTES` in
    `server/src/server.ts`, D-5995; review 951 F1).
- Produces a helper in `routes.ts`, for example `composeReviewCapAsk(coord, io, work): Promise<ReviewCapAsk>`. It holds
  the four lines the refusal arm has today, and the arm calls it.

- [ ] **Step 1: Write the failing tests.**
  - "GET /api/coord/review-cap/:id answers the refusal's own ask". Refuse a fourth open and keep the 409's `ask`. The GET
    answers 200 with an `ask` deep-equal to it, a numeric `askedAt` and a `null` `liftedAt`. After a lift, `liftedAt`
    is a number.
  - The findings states. With a fixture report under the fixture HOME, `findings.state` is `'read'` and lists its
    `## Findings` bullets. With the report deleted it is `'absent'`. With no report artifact on the mail it is
    `'unnamed'`.
  - The refusals. A review run's id and `999999` answer 404. `0`, `01` and `abc` answer 400. A run the store cannot
    read answers 503 (D-6912).
  - The gate. With `authEnabled`, no cookie answers 401, and the box token alone also answers 401.
  - "the cap notice is the one `kind: 'run'` record with no session". A text scan of `server/src` finds exactly one
    `kind: 'run', sessionId: ''` writer, and it is in the refusal arm. The PWA's Mail door relies on that match.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.** Move the types, extract the helper, then add the route beside the POST. Update
  `auth-gate.test.ts`'s counted lists for one more gated route. Each count's comment names this route and D-6910.
- [ ] **Step 4: Run them and see them pass,** then `single-definition`, `coord-pause-route`, `box-token-census`,
  `refusal-status`, `rings/outward-edges`, `rings/pwa-rings`, `rings/totality`, `rings/wire-totality` (correction 10),
  `secret-mask` (review 951 F1) and `typecheck-tests`.
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
  `refusal-status`, `rings/outward-edges`, `rings/pwa-rings`, `rings/totality`, `rings/wire-totality` (correction 10),
  `secret-mask` and `session-hook` (review 951), `typecheck-tests`, and `deviation-refs` after `git fetch origin main`. From `pwa/`: the whole suite, then
  `npm run build`.
- [ ] **Step 3: The plan's As built note,** at the end of this file. Record what each deviation became, the mutation
  table's endings, the measured growth of the growth-checked files, and D-6912's state.
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
- **D-6912.** `GET /api/coord/review-cap/:id` answers 503 `run-unreadable` when the store's read of the run fails, a
  third refusal Task 2's interface did not name (it named 404 and 400). Kept, because folding a failed read into the 404
  would say "not a work run" of a run the server could not read: two conditions a caller handles differently, one
  value. The GET's docstring names it, a run-routes row reaches it, and `REVIEW_CAP_REFUSAL_TEXT` words it, with a
  lift-cap-sheet row (review 951 F4).

## Coordinator corrections, mid-wave (2026-10-25)

1. The GET's refusals go through `refuseRoute(reply, 'bad-request' | 'not-found', { detail })` after `notConfigured`, as the sibling POST does. No inline `reply.code(4xx).send`: refusal-status pins `coord/routes.ts`'s inline sends at 119, and that count may only shrink.
2. The "one `kind: 'run'` notice with no session" pin is a `scan/parse.ts` census, never a text grep or a `readFileSync` of `routes.ts`. It walks `server/src` with `rings/walkSrc.ts` and takes `parseFile(f).calls` named notice, notify or notifyEach whose first argument has `kind: 'run'` and `sessionId: ''`. It expects exactly one, in `coord/routes.ts`, inside the `app.post('/api/runs', …)` span. A CONTROL row through `parseSource` uses a reformatted literal. single-definition holds `routes.ts` at exactly 38 in the W1a and W1b ceilings.
3. LiftCapSheet words both calls' failures through a new `REVIEW_CAP_REFUSAL_TEXT` in `pwa/src/lib/refusalWords.ts`, beside `RUN_ROUTE_REFUSAL_TEXT`, keyed on `bad-request`, `not-found` and `not-configured`, and read as `refusalText(err, REVIEW_CAP_REFUSAL_TEXT) ?? apiErrorText(err)`. Keep AbandonSheet's busy flag and superseded guard, but none of its `code === …` branches: refusal-literal-ratchet pins 32 literal branches, and only an operator ruling may raise that. 401 stays the api funnel's login screen. Add one lift-cap-sheet row per word.
4. The Mail door's match is one pure `capDoorRun(ev: NotifyEvent, live: readonly RunSummary[]): RunSummary | null` in `reviewCapWords.ts`. It keys on `ev.kind === 'run'`, the run found through `eventRunId(ev)` (never `ev.runId`), and `capWaiting(run) === 'waiting'`. `sessionId === ''` stays as a narrowing clause, so M4 still mutates it. Say in D-6911's As built note that the measured cap state is the key.
5. MailScreen gives `capDoorRun` the fleet store's live runs (`store((s) => s.runs)` once the runs frame has been seen, otherwise no door), never its once-per-mount `runsById`, and its onDone re-reads nothing. RunsScreen's band takes the board's existing active list, and its onDone may reload the cold runs. Add a mail-screen row: when the runs frame turns `liftedAt` non-null, the door goes away without a remount.
6. Add C5 file rows for `fleet/reviewCapWords.ts`, `fleet/LiftCapSheet.tsx` and `fleet/ReviewCapBand.tsx` to the ring-context map in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, beside AbandonSheet's. Run `rings/totality` and `docs-parity`.
7. The findings words move with the types. `REVIEW_FINDINGS_WORDS: Record<'absent' | 'unreadable' | 'unnamed', string>` and `REVIEW_FINDINGS_NONE_OPEN` go in `shared/api.ts`, and `findingsWords` reads them. `reviewCapNotice` reads the absent, unreadable and none-open entries and stays silent on `unnamed`, so its text stays byte-identical. Add a guard row: for those three, the notice body contains the table entry, and for `unnamed` it contains none of them.
8. The round predicate is written once. `reviewRounds(id)` becomes `this.reviewCapStates([id]).get(id)?.rounds ?? 0`, or both share one private SQL fragment. Add a row: openRun's refusal `by` equals `reviewCap.rounds` for the same run.
9. Add `ReviewCapLiftAnswer { ok: true; run: number; rounds: number; cap: number; lifted: true }` to `shared/api.ts`. The POST's literal gains `satisfies ReviewCapLiftAnswer`, with no byte change on the wire, and `api.liftReviewCap` returns `Promise<ReviewCapLiftAnswer>`.
10. Add `refusal-status`, `rings/outward-edges`, `rings/pwa-rings`, `rings/totality` and `rings/wire-totality` to Task 2 Step 4 and Task 5's server gates, and drop "rings (if present)".

Not this wave: a `cause` field on NotifyEvent, a separate move-only commit for the helper (optional, and your call), and the door on the run card.

Sequencing: if #1430 or #1406 lands before you push, merge main, then re-measure `store.ts` and `routes.ts` growth against the merge-base and re-run run-routes and single-definition. Whichever of #1398 and #1390 lands first, your C5 rows rebase over its edits to the 08-10 spec.

If any item contradicts what you have measured at your tip, stop and ask me before choosing.

## Coordinator rulings on review 951 (2026-10-25)

Recorded verbatim from the fix-round mail, with one substitution: the README claim holder's session name is written
`[the README's claim holder]`, because this repository names no session.

Run 946, wave 1: fix round 1, ruled on review 951 at d796ba10d. Record everything from this line on verbatim in the plan, as "Coordinator rulings on review 951 (2026-10-25)". Leave out the report path above it, because it names a session. Run 946 is back at working.

Review 951 ran the held-out panel and a door-auth lens: 26 agents, none died. The findings are four (F1-F4), plus ten advisories. These hold: D-6909, D-6910, the notice census, D-6911, the C5 rows, all ten corrections recorded word for word, M2 and M4 reproduced, growth with no waiver, and the auth of both cap routes. Your four red reports were load. Two CI legs are red on this wave's own lines, so PR #1524 is blocked.

First, merge origin/main. It is 6 commits ahead and merges clean. Then:

1. **F1, important: mask the GET.** Add `/api/coord/review-cap/:id` to `MASKED_GET_ROUTES` in `server/src/server.ts`. Its answer carries session-derived text, the review-done summary and the report path, and D-5995 masks every such egress unless an exemption argues otherwise. Nothing argues one here.
   - Add a row: a summary with a planted secret-shaped token comes back masked from the GET, and the sheet's own words are intact.
   - `secret-mask.test.ts` must be green. Its "2 MB TUI pane history" timing row was red for the reviewer under load and green in CI. Re-run it alone before calling it real.
2. **F2, important: re-ground the README anchors.** The 61 lines added to `shared/api.ts` moved four README citations, and `session-hook.test.ts` reds on two rows: the citation debt, and README's own census entry.
   - After the merge, point each anchor at the lines its sentence quotes. Re-measure the debt and lower it, never the rule.
   - README.md is under [the README's claim holder]'s claim 2523. Ask it for consent for those anchor lines only, as you did for 9701. If it refuses or does not answer, ask me.
   - `session-hook`, `citations` and `docs-parity` must be green.
3. **F3: fix the wording, with no code change.** In `reconstruction-drill.test.ts` (about :287-290) and the plan's As built, a coord.db loss resets the rounds to 0. That is the permissive direction, not the safe one. Keep the assertion that `reviewCap` is not rebuilt, and give its true reason: the rounds come from review runs that the drill does not rebuild. A wrong safety claim is fixed in this round.
4. **F4: ledger the third refusal as D-6912.** The spare is for exactly this. The GET's `run-unreadable` (503) when the store read fails is a departure from Task 2's interface. Write D-6912's entry in the plan as that departure.
   - Add a run-routes row that reaches the 503.
   - Name it in the GET's docstring.
   - Add a `run-unreadable` word to `REVIEW_CAP_REFUSAL_TEXT`, with a lift-cap-sheet row.
   - Fix that table's docstring, which is A4. refusal-literal-ratchet stays at 32, since a table entry is not a branch.

**Fix these advisories in this round:**
- A1: move `composeReviewCapAsk` and its JSDoc above `childReclaimPort`'s docblock.
- A3: correct the `REVIEW_FINDINGS_WORDS` comment on `unnamed`.
- A6: bring the plan's steps in line with correction 10 and with D-6912's new use.
- A7: add the planned `unnamed` row, a review that reported with no report artifact.
- A8: record M1's reds as the lens measured them.
- A9: reword the auth-gate comment. `reviewCap` rides `GET /api/runs`, which a box-token holder reads, and only the composed ask is session-only.

**Carried to a later wave, recorded in the ledger:**
- A2: "no review reported" keyed on `summary`, in the sheet and the notice alike.
- A5: the census's quote-style regex.
- A10: the coord-pause-route scan string.

**Gates.** Re-measure growth against the new merge-base; `server.ts` is growth-checked too. Run every gate in the brief, Task 5 and correction 10, plus `secret-mask`, `session-hook`, `citations` and `docs-parity`, one file at a time with `--pool=forks --maxWorkers=2`. A file that times out is re-run alone, and you say so.

**Claims.** Take claims on `server/src/server.ts`, `server/test/secret-mask.test.ts` and `server/test/session-hook.test.ts`. Your claims 2505 and 2507 reach hard expiry at about 01:08Z and 01:17Z, so re-take them before then if the round runs long.

If any item contradicts what you measure at your tip, stop and ask me before choosing. Then send a fresh wave-done.

## Coordinator rulings on review 960 (2026-10-26)

Recorded verbatim from the fix-round mail.

Run 946, wave 1: fix round 2, ruled on review 960 at f907225ad. Record everything from this line on verbatim in the plan, as "Coordinator rulings on review 960 (2026-10-26)". Leave out the report path above it, because it names a session. Run 946 is back at working.

Review 960 ran the held-out panel and an egress lens: 26 agents, none died. Everything else measured holds: M7, the anchors, the rulings record, the three merges, growth, every suite, and CI green at the tip. Two findings are important, and both are fixed in this round. Two advisories are fixed with them.

1. **F1, important: no cut may leave a partial token.** The summary (600 chars) and each findings line (300 chars) are cut after shape-redaction and before the answer hook. The hook masks a key only whole, so a key the cut splits goes out as an unmasked prefix. The reviewer measured 14 characters out through the real GET. The cuts came with #1331 and also feed the 409 refusal's `ask` and the notice and push body. This wave's GET makes the same text readable at any time, so the gap is closed here.
   - Write one pure helper in `reviewcap.ts`. It cuts at the limit, and when the cut falls inside a run of non-whitespace it drops that whole trailing run. Then it adds the marker it adds now.
   - Use it for every one of these cuts, the summary's in `store.ts` and the findings lines' in `reviewcap.ts`, so all three egresses share it. A text with no whitespace before the limit comes out as the marker alone. That fails toward hiding.
   - Rows: a secret-mask row with the compatible key planted across char 600 of the summary, and one across char 300 of a findings line. The GET's answer holds no 8-character prefix of either key. Add one row for the 409 refusal's `ask` too.
   - M8: drop the trailing-run rule, measure those rows red, then restore with cmp. Add M8 to the mutation table.
   - The notice text changes only where a cut used to fall inside a token. Say so in As built.
2. **F2, important: the docstring sentence.** Add to the GET's docstring (`routes.ts`, about :2193-2197): "503 `run-unreadable` when the store read fails (D-6912)." The plan's D-6912 entry and As built already say it is there, so this makes them true. Note the miss in As built.
3. **V1: pin `not-configured`.** Add one row per cap route with no coord store: each answers 501 `not-configured`. Dropping either `notConfigured` guard must red one.
4. **V2: fix the note in `session-hook.test.ts`, about :9072.** The 61 lines are two hunks, +50 at :6472 and +11 at :6626, not one.

**This is the last round the cap allows without the operator.** Review 960 was round 2 of 3, so a third review can open. A fourth would need the operator to lift the cap. Keep the round to these four items, with no other edits.
- Merge origin/main only if the merge probe exits nonzero (clause 16). A clean branch lands as it is, and the merge queue now runs the full suite.
- Gate the push on the probe's rc, in its own step.

**Gates.** Run review-cap, run-routes, routes, secret-mask, reconstruction-drill, refusal-status, single-definition, growth-check, the five rings suites, docs-parity, citations, session-hook, typecheck-tests and deviation-refs. Then run the touched PWA files and `npm run build`. Run each file whole, one at a time, with `--pool=forks --maxWorkers=2`. A file that times out is re-run alone, and you say so. Re-measure growth: `store.ts` is growth-checked.

**Claims.** Your claims 2505 and 2507 reach hard expiry at about 01:08Z and 01:17Z. Re-take them first, before you edit `store.ts`.

If any item contradicts what you measure at your tip, stop and ask me before choosing. Then send a fresh wave-done.

## Coordinator rulings on review 962 (2026-10-26)

Recorded verbatim from the mail.

Run 946, wave 1: review 962 ruled, and a conflict-sync. Record everything from this line on verbatim in the plan, as "Coordinator rulings on review 962 (2026-10-26)". Leave out the report path above it, because it names a session. Run 946 is back at working, for the sync only.

Review 962, the third and last round under the cap, ran the held-out panel and the egress lens: 32 agents, none died. Everything measured holds: F1's fix, F2, V1, V2, the rulings record word for word, the 8-file scope, M8 and M9, growth, every suite, and CI green at 1bd054e00. The wave is ACCEPTED on that reading.

**F1 does not block. It is carried to a later wave.** A text cut to empty is worded falsely. If every findings line is one 300+ character token, the sheet reads "The report lists no open findings.", and a summary that opens with a 600+ character token reads "No review has reported yet." beside the report's path. It does not block for these reasons:
- the leak is closed, and every boundary case fails toward hiding;
- only a pathological input reaches it, since real bullets and summaries carry whitespace early;
- the report's path is always shown beside it;
- three of the four lenses refuted it 3-0;
- its summary half is review 951's A2, already carried;
- a fix would need a fourth review, which needs the cap lifted by the console door this PR adds.
The later wave words the empty-cut states as withheld, and tells a null summary apart from no review by `reviewRunId`.

**A1 to A5 are carried to the ledger.**
- A1: the cut's docstring rule.
- A2 and A3: As built's row count, and its missing gate and growth record.
- A4: the 8-slot cap before the empty filter.
- A5: the push body has no byte bound. This predates the wave.
Make no edit for them now.

**The conflict-sync.** PR #1524 conflicts with main, measured at 01:4xZ. merge-tree exits 1, with conflicts in `server/test/auth-gate.test.ts` and `server/test/coordinator-skill.test.ts`. Main has 8 commits since your merge-base, among them #1392, #1399, #1430 and #1526.
- Merge origin/main. In each conflict, keep both sides: the union of the route entries, and each count recomputed from the merged tree. Make no other edit, apart from this rulings section and one As built line naming each resolution.
- Gates: auth-gate, coordinator-skill, box-token-census, coord-pause-route, single-definition, growth-check, routes, run-routes, secret-mask, typecheck-tests and deviation-refs. Run each file whole, one at a time, with `--pool=forks --maxWorkers=2`, and re-run a timeout alone.
- Run the merge probe in its own step, and push once only if it exits 0.
- Send a wave-done for that tip. Say which files differ from 1bd054e00 other than by main's own changes. It should be only the two conflicted tests, the plan, and any count that main's routes moved.
- There is no review round after this. The merge queue re-tests the combined code with the full suite, and I enqueue the PR once its required checks pass.

If the conflicts reach any file beyond those two tests, stop and ask me before resolving them.

## As built (2026-10-25)

Built on `origin/main` at `d12739bd6`: the plan's five tasks, one commit each after the plan's copy, then one commit
applying the coordinator's mid-wave corrections above, all ten. #1406 landed before the push, so, as the corrections'
sequencing line says, `origin/main` was merged in at `eacd79233` (no conflicts), growth re-measured against the new
merge-base, and the server gates re-run on the merged tree. #1430, #1398 and #1390 had not landed.

**What each deviation became.**

- **D-6909, as planned.** `RunSummary.reviewCap` is filled in `hydrateRun` from `CoordStore.reviewCapStates`, two
  statements per batch on `healthFor`'s `placeholders` idiom; `run()` and `hydrateRuns()` are its two callers, and
  `reviewRounds` now reads `reviewCapStates` too, so the round predicate is written once (correction 8; a run-routes row
  holds the refusal's `by` equal to the row's `reviewCap.rounds`). An unknown kind and an unmeasured field both fold to
  "no door", because no caller tells them apart. Making the field required touched every `RunSummary` literal in the
  tests: 21 PWA fixture factories gained `reviewCap: null` (one of them, `runs-finished-fold.test.tsx`, under another
  wave's claim, with its holder's written consent for that one token), and `reconstruction-drill.test.ts` names
  `reviewCap` among what a coord.db loss forgets. It is not rebuilt because its inputs are not: `review_cap` lives only
  in the database, and the rounds count review runs, which the drill does not rebuild. So a loss resets the rounds to 0
  and three more reviews open before the cap refuses again, the permissive direction (corrected in fix round 1, review
  951 F3; this note first called it the safe one).
- **D-6910, as planned.** `composeReviewCapAsk` in `coord/routes.ts` holds the refusal arm's three lines, and both the
  arm and `GET /api/coord/review-cap/:id` call it. The GET answers `notConfigured` first and every refusal through
  `refuseRoute` (correction 1): 400 `bad-request`, 404 `not-found` for a run that is not a work run, 503
  `run-unreadable` (D-6912, ledgered in fix round 1). Its answer is masked by the one answer hook: the route is in
  `MASKED_GET_ROUTES` since fix round 1 (review 951 F1), because the ask carries the review-done summary and the report
  path. The POST's literal is `satisfies ReviewCapLiftAnswer` (correction 9). The three ask types moved to
  `shared/api.ts`. That file cannot import `ReadFailure` (its type-only imports are pinned), so the findings states
  derive from `REVIEW_FINDINGS_STATES`, `STALL_STORED_STATES`' idiom, and `review-cap.test.ts` holds the failure pair
  equal to `ReadFailure` at compile time. The findings words moved with the types (correction 7):
  `REVIEW_FINDINGS_WORDS` over the three unread states and `REVIEW_FINDINGS_NONE_OPEN`. The notice reads three of them
  and stays silent on `unnamed`, its text byte-identical, and a guard row pins both halves. The new route joined the
  canonical id census (`routes.test.ts`, twenty-one seams) and the gate's route counts (`auth-gate.test.ts`, and
  `auth/gate.ts`'s docstring: 121 HTTP routes). The two "box token alone is refused" rows were green before the route
  existed, because the gate refuses every path no EXEMPT entry names; they pin that neither cap route joins one. The
  GET joined `coordinator-skill.test.ts`'s set of coord routes no skill names, beside the POST, for the caps reason (the
  read is the first half of the invitation); its forbid-mention case already covers it. That file was under another
  wave's claim, and its holder consented to that one entry.
- **D-6911, as planned, keyed on the measured cap state.** The Mail door is `capDoorRun(ev, live)` in
  `reviewCapWords.ts` (correction 4): it opens only for a run that the fleet store's live runs frame holds and whose
  ask is raised and not lifted, found through `eventRunId`. `kind: 'run'` and an empty session only narrow it, and M4
  still mutates that clause. `MailScreen` passes the frame's runs once the frame has been seen and no runs before, never
  its once-per-mount read, and its sheet has no `onDone` (correction 5): the watcher re-emits `runs` when a row
  changes, so a lift takes the door away on the next frame, which a mail-screen row pins without a remount. The server
  pin is a `scan/parse.ts` census (correction 2): every `notice`, `notify` or `notifyEach` call under `server/src`, read
  with `rings/walkSrc.ts`, finds exactly one whose record literal says `kind: 'run'` and `sessionId: ''`, inside
  `app.post('/api/runs', …)`. It tests every argument rather than only the first, so a `notify(deps, {…})` writer, whose
  record is its second argument, is caught too; its CONTROL row plants both shapes. `single-definition`'s W1a and W1b
  rows for `coord/routes.ts` stay at 38. The sheet words both calls' failures as
  `refusalText(err, REVIEW_CAP_REFUSAL_TEXT) ?? apiErrorText(err)` (correction 3), one row per word, and keeps
  `AbandonSheet`'s busy flag and superseded guard but none of its branches. The band's ground is grouped with the sheet
  bodies' rule in `fleet.css`: a rule of its own copied `.program-start-sheet`'s shape, and `shape-census` refused it.
  The three new PWA files have C5 rows in the 08-10 spec's ring-context map (correction 6).
- **D-6912, spent in fix round 1 (review 951 F4).** The GET's 503 `run-unreadable` when the store read fails, a refusal
  Task 2's interface did not name. Its docstring names it, a run-routes row reaches it beside the other unreadable-run
  refusals (and holds the absent run at 404), and `REVIEW_CAP_REFUSAL_TEXT` words it, with a lift-cap-sheet row.
  `refusal-literal-ratchet` stays at 32: a table entry is not a branch.

**Mutation table.** Measured after the corrections. Each mutant ran on the tree with the original backed up to scratch,
under `ulimit -u (threads + 1500)` and `timeout -k 10 600`; each file was restored and checked byte-identical by `cmp`.

| Mutant | What went red |
|---|---|
| M1 `hydrateRun` sets `reviewCap: null` | First recorded as run-routes "carries the cap's state" alone. Review 951's does-it-reproduce lens measured three reds: that row and two GET rows that read `reviewCap` and answer 404, one of them M6's deep-equal row, plus a fourth row timed out under load (A8). Re-measured in fix round 1 over the cap's describes and secret-mask's row: five reds, "carries the cap's state", "answers the refusal's own ask", both "says unnamed" rows and secret-mask's masked-summary row |
| M2 `capWaiting` drops `liftedAt === null` | words "lifted is lifted", band list row, Mail "no door once lifted" and "takes the door away … without a remount" |
| M3 `capWaiting` drops the closed-run test | words closed-run row, band list row and "renders nothing", Mail "no door on a closed run" |
| M4 the Mail door drops `sessionId === ''` | Mail "no door on a run record that names a session" |
| M5 the sheet posts on open | sheet "reads the ask once", "Lift cap posts once", "Cancel lifts nothing" |
| M6 the GET composes its own ask, findings `unnamed` | run-routes "answers the refusal's own ask" |
| M7 (fix round 1) the GET leaves `MASKED_GET_ROUTES` | secret-mask's masked-summary row, and its egress inventory row ("is neither masked nor exempt") |
| M8 (fix round 2) `cutWhole` drops its trailing-run rule (`return cut`) | review-cap's three `cutWhole` rows that cut inside a token, secret-mask's "sends no part of a key that the summary's or a findings line's cut falls inside", and run-routes' "the 409's ask sends no part of a key" |
| M9 (fix round 2) either cap route drops its `notConfigured` guard | run-routes' 501 row for that route: "GET … answers 501 not-configured" for the GET's, "POST … answers 501 not-configured" for the lift's |

**Growth.** Net code lines against the merge-base, measured with `growthCheck.ts`'s `netGrowth` after the merge:
`server/src/coord/store.ts` +19, `server/src/coord/routes.ts` +16, `pwa/src/lib/api.ts` +3. Re-measured in fix round 1
against the new merge-base `82a68c15d`: the same three, and `server/src/server.ts` +0 (one entry added to an existing
line).

**Suite.** The first full PWA run after Task 4 was red in one file, `shape-census` (the band's copied rule); grouping
the rule made it green. The second full run, after the corrections, was red in one file, `contrast.test.ts`, on a
per-case `Test timed out in 5000ms` at a load near 35. Re-run alone it timed out on other cases twice, passed all 295
with a 30 s case budget, then passed all 295 alone at the default. On the merged tree, `typecheck-tests` timed out on
three cases in the gate batch and passed all 12 re-run alone.

**Fix round 1 (review 951, 2026-10-25).** `origin/main` was merged first, at `82a68c15d`, with no conflicts, as the
rulings order. Then F1 to F4 and A1, A3, A4 and A6 to A9 as ruled; A2, A5 and A10 are carried to a later wave. F1's row
sits in `secret-mask.test.ts`, not run-routes: `lastReviewReport` shape-redacts the summary where it reads it, so a
shaped key never reaches the answer hook. The row plants a compatible key with dots in it, which the redactor keeps and
only a fingerprint row catches; a first draft with a shaped key came back `[REDACTED]` and proved nothing about the hook.
F2's four anchors were re-anchored by content, with the README claim holder's consent for that one sentence. The debt
map's `shared/api.ts` entry went from 5 back to its census of 1, so no number in the test changed, and the README census
row's comment records the re-anchor. The rulings section above is word for word, except the claim holder's session name.

Fix round 1's gates, one file at a time with `--pool=forks --maxWorkers=2`, at loads from 35 to 56: every server gate
the brief, Task 5 and correction 10 name is green, and `session-hook` too. `secret-mask` was green except its "2 MB
TUI pane history" timing test (red at load 47 in the batch). That test is red on a clean `origin/main` checkout at the
same load as well, and it passed alone on both trees at load 35. The whole PWA suite passed, all 314 files, and
`npm run build` is green.

Then, before the push, the merge-tree probe exited 1: main had moved, and #1515 added a method directly above
`reviewRounds` in `store.ts`. That is clause 16's conflict trigger, the first on this PR, so `origin/main` was merged
again, at `a24ff9c47`, keeping both sides of that one hunk. Growth against the new merge-base is unchanged (+19, +16,
+3, +0). Every gate re-ran on that tree, one file at a time, at loads from 43 to 63, and all are green. Two server
files went red under load and passed in full alone: `secret-mask`, on its 20,000-match timing bound, and
`deviation-refs`, on its tree scan's 20 s case budget. In the whole PWA suite, 311 of 314 files passed. The other three,
`contrast`, `dialog-sheet` and `wrap-screen-golden`, were red only on per-case 5 s timeouts, and each passed in full
alone. `npm run build` is green.

That tip, `f6fce7bfa`, was pushed in the same command as the final merge-tree probe, not gated on its answer. The
probe exited 1: main had moved again, and #1390 had edited the 08-10 spec's ring map beside the C5 row. No wave-done
named that tip. Under the corrections' sequencing line on #1390, `origin/main` was merged a third time, at `a2269126b`,
keeping main's C4 row and this wave's C5 row; the spec differs from main by that row only. On that tree every server
gate and the seven touched PWA files are green. Three server files went red in the batch, at load 51 to 56: a
`single-definition` scan case and `deviation-refs`' tree scan on their 20 s case budgets, and `secret-mask`'s 2 MB
timing bound. Run alone with a larger case budget, the first two passed; the third is red on a clean `main` at the same
load. Every later push is gated on the probe's exit code, in its own step.

**Fix round 2 (review 960, 2026-10-26).** The four ruled items and nothing else; `origin/main` was not merged, because
the merge probe exited 0. Claims 2505, 2507, 2509, 2511 and 2516 were released and re-taken before any edit, as 2549 to
2553.

- **F1.** One pure helper, `cutWhole` in `coord/reviewcap.ts`, makes both cuts: the summary's (600 characters, in
  `CoordStore.lastReviewReport`) and each findings line's (300, in `extractOpenFindings`). So the 409 refusal's `ask`,
  the notice and push body, and the GET all share it. When a cut falls inside a run of non-whitespace, it drops that
  whole run. The ruling said the helper then "adds the marker it adds now", but neither cut added a marker, here or on
  `origin/main`. Asked through the structured ask, the coordinator ruled: no marker. So a text with no whitespace before
  the limit comes out empty: such a summary reads `null`, as an empty one already did, and such a findings line is
  dropped. The notice text changes only where a cut used to fall inside a token, and there it loses that token's
  prefix. Rows: three pure `cutWhole` rows and one `extractOpenFindings` row in review-cap; a secret-mask row with
  fingerprinted keys planted across character 600 of the summary and character 300 of a findings line, whose GET answer
  holds no 8-character piece of either; and a run-routes row for the 409's `ask` across the summary's cut. M8 is in the
  table above.
- **F2.** The GET's docstring now names the 503 `run-unreadable` (D-6912). Fix round 1's edit of that docstring never
  applied: it was a text replacement with no assertion, and its indentation did not match. The commit message, the
  D-6912 entry and this note all said it was done; review 960 found it was not.
- **V1.** A run-routes row per cap route with no coordination store answers 501 `not-configured`; M9 drops either guard
  and reds its row.
- **V2.** `session-hook.test.ts`'s re-anchor note now names two hunks in `shared/api.ts`, +50 at `:6472` and +11 at
  `:6626`, where it said one.

**Conflict-sync after review 962 (2026-10-26).** `origin/main` was merged at `e0a36f311`. In both conflicted tests,
`GET /api/coord/review-cap/:id` met main's `GET /api/coord/shadow-journal` (#1392), and each was resolved by keeping both.
`coordinator-skill.test.ts` keeps both EXEMPT entries, this wave's first. `auth-gate.test.ts` keeps main's 46 and 124
history lines, adds 47 and 125 lines for this route, and recomputes the counts from the merged tree: coord routes 47,
`ROUTES` 125, the HTTP half 122, gated 80, exempt still 42. The three comments its prose pins read now say 125 and 122.
`auth/gate.ts`'s docstring goes to 122 routes.
