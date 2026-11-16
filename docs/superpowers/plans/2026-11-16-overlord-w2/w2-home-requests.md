# Overlord W2: the home's requests and next steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on the Overlord place the operator sees every request grouped by what they must do next, acts on it in one
tap, rules a goal conflict where it blocks work, and sees what each request and programme cost.

- **PR A, on the server: next steps, the tap and spend.**
  - The three fixed texts of the next-step controls live in `shared/nextSteps.ts`. One L1 decider offers a control from
    the linked pull request's state, through the existing PR reader.
  - A tap goes through the console's prompt route to the coordinator that owns the request. The server stamps it on the
    request as news and writes no `operator_messages` row.
  - What a request cost is read from `run_spend` over the runs that carry its `requestId`. The Overlord's own spend
    rides the readiness read.
- **PR B, in the console, with one server task.**
  - The Requests part (Table 4a's row 6) in Table 4b's groups. Each row shows its owner, last news, age and spend, its
    next-step control, the operator's request doors and the Seen control on its acts.
  - Standing goal conflicts on the portfolio strip and on the rows they block, ruled from the pair's row.
  - The request ids and the matched names under each operator message in the chat.
  - A request's quote, the operator's own cited words, read from the private store when a row is expanded.
  - Request changes in "since you were last here", the strip's health word and 85% date, and the readiness line's own
    spend.

**Why:** spec §4 (Table 4a's rows 1, 4 and 6, and Table 4b), §5.1 ("The chat shows what each message became"), §5.4
("Standard next steps are one tap"), §5.6 ("What it cost", the strip, goal conflicts and the ruling door), §3.8 (a tap is
the operator's own prompt to a coordinator, never a message to the Overlord) and §10.3 (H18: an operator's tap is never
refused for a stale revision). W1's home plan left these parts to W2: "W2: the Overlord's own spend, the requests, and
the portfolio's health words and 85% dates" (`w1-home.md`, Where things stand).

**Architecture:** two pull requests in lane F.

| Part | File | Ring and context | PR |
|---|---|---|---|
| The three fixed texts and the prompt line | `shared/nextSteps.ts` (new) | L0, C5 | A |
| `nextStepFor`, and `tapTargetOf` (the tap's refusal set, F16) | `server/src/coord/nextStep.ts` (new) | L1, C5 | A |
| The prompt route's tail, moved out of the route: known id on the target, `renewing`, the draft rule, `sendPrompt`, the W1a mark | `server/src/promptSession.ts` (new, `promptSession`) | L4, C3 | A |
| `spendOfRuns` and `overlordSpendOf` | `server/src/coord/spend.ts` (new, or forecasts B's summation moved here) | L1, C5 | A |
| The facts: a request's linked runs, their PR states and their spend rows | `server/src/coord/requestFacts.ts` (new) | L3, C5 | A |
| The tap | `server/src/coord/nextStepTap.ts` (new), one branch in `server/src/server.ts`'s prompt route; both paths end in `promptSession` | L4, C5 | A |
| A request's quote, from the private store, on demand (F15) | `GET /api/requests/:id/quote` in `server/src/coord/requestRoutes.ts`, through request ids B's `attestedQuoteOf` | L4, C5 (the read), C11 (the store reads) | B |
| The Overlord's own spend on the readiness read | `server/src/coord/overlordRoutes.ts` (readiness piece's handler) | L4, C5 | A |
| `spend` and `nextStep` on the requests read; `matched` on the chat read | `server/src/coord/requestRoutes.ts`, `server/src/coord/overlordRoutes.ts` (chat A's read) | L4, C5 | B |
| The console's deciders and words | `pwa/src/overlord/requestsWords.ts`, `requestControls.ts`, `portfolioWords.ts` (home B's), `sinceWords.ts` (home B's), `chatWords.ts` (chat A's) | L1 | B |
| The parts | `pwa/src/overlord/RequestsPart.tsx`, `RequestRow.tsx`, `GoalConflictSheet.tsx`, `PortfolioStrip.tsx` (home B's), `ReadinessPart.tsx` (home B's), `OverlordChat.tsx` (chat A's) | L4 | B |
| The store | `pwa/src/stores/overlord.ts` (home A's) | L4 | B |

**Tech Stack:** TypeScript (ESM), React, Fastify, `node:sqlite`, vitest and its browser runner. No new dependency, no
migration and no ccd verb.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`: §4 and Tables 4a and 4b; §4.1 and Table 4.1b; §5.1;
§5.3 (C12, the name match); §5.4 (C16, "Standard next steps are one tap"); §5.5; §5.6 (H38, "What it cost", the strip,
goal conflicts); §3.8 ("A tap on a next-step control is the operator's own prompt to a coordinator"); §7.5 (the
`operator-at-programme` mark); §10.2 and §10.3 (H18); Table 11.1e's prompt-route row.

**The index:** `docs/superpowers/plans/2026-11-16-overlord-w2.md`: its row "Home: requests and next steps" (lane F, 2
PRs, 9 tasks, A 3 and B 6; this plan has 10, B 7, section 8), its questions 5, 17 and 22, and "Where lanes meet" for `server/src/server.ts`,
`pwa/src/lib/api.ts` and the portfolio module. Forecasts B's plan amends question 22 to read `run_spend` and adds the
edge `FCB --> HRA` (`w2-forecasts-health.md`, "What the index should change"); this plan builds that amendment.

**The plans this one reads** (each piece's plan is the authority for its interface; each task's first step re-measures
the names it takes on `main`):

| Plan | What this plan takes from it |
|---|---|
| `w1-home.md` (home A, B, C) | `pwa/src/stores/overlord.ts`, `OverlordPlace.tsx` (one column, Table 4a's order), `PortfolioStrip.tsx` and `portfolioWords.ts`, `ReadinessPart.tsx`, `sinceWords.ts#sinceLines` with `lastHere.ts`, the one `useStepUp` for the place, `server/test/sim/homeSets.ts`, `serverCaps()` |
| `w1-chat.md` (chat A) | `shared/overlordChat.ts#ChatEntry` (W2 adds a field to its message arm), `server/src/coord/overlordChat.ts#composeChat`, `OverlordChat.tsx`, `chatWords.ts`, `overlordSend` |
| `w1-readiness.md` | `ReadinessWire` and `GET /api/overlord/readiness` |
| `w2-request-ids.md` (request ids A, run 2274's branch) | `runs.requestId`, `stampRequestNewsInTx` (bookkeeping, never raises the revision) |
| `w2-requests.md` (request record A, #2928) | `requestById`, `RequestRow`, the ten states, `REQUEST_TRANSITIONS` |
| `w2-forecasts-health.md` (forecasts B, #2921) | `run_spend` (`measured`, `absent`, `outside`), the spend read's rules, `PortfolioEntry`'s `health`, `forecast` and `spend`, `PortfolioView.calibration` |
| `w2-operator-request-doors.md` (run 2278's branch) | `GET /api/requests` and `RequestListRow` (id, state, group, owner, news, `lastNewsAt`, `openedAt`, `closedAt`, `takenFrom`, `revision`, parent id, cited message ids); the five doors with `{ revision }`, their answers (`applied`, `outcomes`, `mailed`), hand back behind the step-up; `REQUEST_GROUP_MAP`; the `requests` bus topic; their client functions and sentences |
| `w2-act-reads.md` (run 2278's branch) | `GET /api/acts?programme=` (the console's `ActView`), `POST /api/acts/:id/seen`, their client functions |
| `w2-overlaps.md` (overlaps B, #2923) | `GET /api/portfolio`'s `pairs` and `pairRate`, `StandingPairWire`, `GOAL_CONFLICT_CHOICES`, `POST /api/programme-pairs/:key/rule` with `{ episode, choice }` (works dark, no step-up), `pair-changed`, and each requests-read row's `blockedBy` |
| `w2-relay.md` (relay A, run 2277's branch) | `server/src/coord/citedNames.ts#citedNamesOf(texts, names)` (RL8: "Home requests B shows the names they matched through the same function") |
| `w2-request-ids.md` (request ids B, run 2274's branch) | `server/src/operatorModel/attestedQuote.ts#attestedQuoteOf` and `CitedRead` (Table 5: a line per cited message, `withdrawn`, `noLongerOnRecord` or `unmeasured` when no words can be shown) |
| `2026-11-10-overlord/w1a-renewal-handoffs.md` (W1a hand-offs, building in #2934) | The prompt route's `renewing` refusal (`promptRenewing(liveStateOf(…))`) and `markOperatorPrompt` after a sent prompt, both inline in the route |

Written against `main` at `fe887521f` (2026-11-16). None of those pieces is on `main` yet.

## In short

- **Two pull requests, ten tasks:** A has three (the server's next steps, spend and the tap), B has seven (one server
  task, then the console, with the quote's read).
- **A next-step control is offered only from measured facts.** "Fix the checks" when the linked pull request's checks
  fail. "Land it" only after a measured accept (ruled, F2): the PR is open, green and not queued, and the run reads
  `merging`, or still reads `awaiting-review` after its latest review run closed with no send-back. Never while a
  review is open. "Address the comments" is never offered in W2, because the PR reader does not measure review
  comments (HQ2). Any linked run whose PR state is not measured offers nothing (F5).
- **A tap is the operator's own prompt.** The server composes the fixed text, which names the request, the run and its
  PR. It sends the text to the owning coordinator's session through the prompt route's own tail (`promptSession`):
  known id, `renewing`, the draft rule, the send and W1a's `operator-at-programme` mark. Then it stamps a fixed news
  line on the request. No `operator_messages` row, no inbox row. The coordinator skill's reference says a "Land it"
  prompt asks for the normal landing gate and never bypasses review or the verdict.
- **No tap is refused for what changed since the read** (H18). A request door tap carries the revision the operator saw
  and is applied; the console shows each raced act's outcome. A next-step tap goes to the request's owner as it stands
  at the tap.
- **Spend is attributed, never zero.** A request's spend sums `run_spend`'s measured rows and the fresh live readings of
  its open runs, and counts every unmeasured run. The Overlord's own spend is its bound session's live reading.
- **Goal conflicts are ruled on the home.** A standing pair shows on the portfolio strip, with Table 1's choices from
  `GOAL_CONFLICT_CHOICES`, and on every Requests row whose `blockedBy` names it.
- **Phone first:** every new part at 360 px with no horizontal scroll, every control at least 44 px, browser runs at 360,
  390, 1280 and 1920 in both skins and both themes.

## 1. Open questions

The coordinator accepted the index's questions 2 to 23 as written; this plan builds on 5, 17 and 22 (as amended by
forecasts B), and on the settled 24 to 29. Item 357 answered question 1; the ruling control renders whatever
`GOAL_CONFLICT_CHOICES` holds and hard-codes no choice. Question 19 (the act ceilings) does not touch this piece: a
next-step tap is the operator's prompt, not an Overlord act, and the doors this piece draws are other pieces'. Every
question below carries a recommendation, which this plan builds unless the coordinator rules otherwise. None needs the
operator.

- **HQ1. The decider's inputs and its table** (slug `next-step-from-measured-pr-facts`). §5.4 names three controls and
  their conditions in words. The existing PR reader is `shared/api.ts#PrState` (phase, `checks`, `checkNames`), filled
  per workspace session by the watcher's PR sweep (`server/src/prstate.ts#prView`), with the merge-queue word from
  `prstate.ts#queueFor`.
  **Recommendation:** `nextStepFor(input)` (L1, first match), where `input` is the request's state and its linked runs.
  Each run carries its id, its run state, its session's `PrState` and queue word (or `unmeasured`), and its review
  facts (F2): when it last entered `awaiting-review`, from its run events (`shared/api.ts#RunRecordEvent`), and its
  latest review run (the highest id among the runs whose `reviews` names it, `RunSummary#reviews`), with that run's
  state and `closedAt`, or `unmeasured`.

  | # | When | Answer |
  |---|---|---|
  | 1 | The request is not `in-progress` | none, `not-in-progress` |
  | 2 | Any linked run's PR is not measured: no reading for its session, or its phase `unknown` or `unchecked` (F5) | none, `pr-unmeasured` |
  | 3 | No linked run's PR is `open` or `draft` | none, `no-pr` |
  | 4 | More than one linked run has an `open` or `draft` PR | none, `several-prs` |
  | 5 | The one PR's checks are `unmeasured` | none, `pr-unmeasured` |
  | 6 | Its checks are `fail` | `fix-checks` |
  | 7 | Review comments are measured as waiting | `address-comments` (never in W2: HQ2) |
  | 8 | It is `open`, not a draft, its checks `pass`, and its queue word is `absent` | none, `pr-unmeasured` (F5) |
  | 9 | It is `open`, not a draft, its checks `pass`, and its run's review facts are `unmeasured` | none, `pr-unmeasured` |
  | 10 | It is `open`, not a draft, its checks `pass`, its queue word is `none` or `dequeued`, and the review is accepted: the run reads `merging`, or it reads `awaiting-review` and its latest review run is `done` with a `closedAt` at or after the run last entered `awaiting-review` | `land-it` |
  | 11 | It is `open`, not a draft, its checks `pass`, and its run reads `awaiting-review` with no such review | none, `review-pending` |
  | 12 | Otherwise | none, `none-obvious` |

  *Table 1. `nextStepFor`. "Several pull requests" is no obvious step, so it offers none. A run whose state is not known
  never stands in for "no pull request".* Row 2 runs before rows 3 and 4: a sibling run whose PR state is not measured
  could be a second open PR, so the table never answers from a guessed single-PR state. `absent` is the queue reader's
  "nothing was asked" (`server/src/prstate.ts#PrQueueRead`), which the landing lane groups with `unmeasured`, so it never
  offers "Land it". `null` checks mean "no checks configured" (`PrChecks`' own comment), which is not green, so row 10
  does not fire on it. In row 10, a send-back moves the run to `working` and a later advance re-enters
  `awaiting-review` after the old review closed, so an old review never accepts a new round. A review run that is open,
  `failed` or older than the latest entry is row 11. `in-progress` covers Table 4b's Working, Ready for review and
  Landing groups. A request in `needs-you` (the operator's, by a take or otherwise) has no owner step to prompt, so it
  gets none.

  Between a review run's close and the coordinator's ruling, row 10 can offer "Land it". The tap is then a request
  for the normal landing gate, never a bypass (HQ19): the coordinator re-measures, rules on the report and enqueues as
  its skill says.
- **HQ2. "Address the comments" waits for a reader** (slug `address-comments-waits-for-a-reader`). `PrState` carries no
  review state, and the only reads of `reviewDecision` in the tree are the admin-merge door's inside `ccd/ccd`. The index
  rules that W2 leaves `ccd/ccd` untouched.
  **Recommendation:** `shared/nextSteps.ts` carries all three texts, and the decider's row 7 reads an input that W2
  always passes as `unmeasured`, so the control is never offered in W2. A later piece that adds review state to
  `ccd pr-state`'s line fills the input; the decider and its tests already cover it. Inventing the step from a run's
  state (a ccrc review run's fix round) would be guessing, because a review run's findings are not the pull request's
  comments.
- **HQ3. No step is operator-only today** (slug `no-next-step-is-operator-only-in-w2`). §5.4: "No control is offered for a
  step that is operator-only." Fixing checks and addressing comments are the worker's, and landing is the coordinator's
  through the merge queue (the coordinator skill enqueues; `CLAUDE.md`'s admin-merge rule refuses the bypass).
  **Recommendation:** the decider takes no operator-only input in W2. A later rule that makes a step the operator's
  adds the input and a row above row 6.
- **HQ4. The tap's body and its text** (slug `next-step-tap-text-is-the-servers`). §3.8: "A tap sends that text, with the
  request id, to the session of the coordinator that owns the request, through its prompt route."
  **Recommendation:** the console posts `POST /api/sessions/:id/prompt` with `{ nextStep: { requestId, runId, step } }`
  and no `text`. `runId` is the run the requests read named with the step. The server composes the text from
  `shared/nextSteps.ts#nextStepPrompt(step, { requestId, runId, pr })`, which names the request, the run and its pull
  request (ruled, F2): for example "Land it (request 42, run 7, PR #123).". `pr` is the run's session's PR number as
  the watcher reads it at the tap; with no reading the text says "PR not measured" in its place. So a tap can only ever
  send one of the three fixed texts. A body with both `text` and `nextStep` is `bad-request`, and so is a `runId` whose
  run does not carry that `requestId`. Every other body takes the route's existing path unchanged.
- **HQ5. Where a tap goes, and what it never refuses** (slug `next-step-tap-goes-to-the-owner-at-the-tap`). The console's
  `:id` is the coordinator it read; the request may have been routed elsewhere, or its programme's coordinator replaced,
  since. H18 says the operator's tap is never refused for a stale revision.
  **Recommendation:** the branch resolves the request's owner and that programme's coordinator at the tap
  (`requestById`, then `CoordStore#programmeCoordinator`, as the operator's doors resolve it) and sends there, whatever
  `:id` says. It answers `{ ok: true, sentTo, step, newsStamped }`, and the console shows "Sent to <sentTo>". It does not
  re-run the decider: the operator chose the step, and a step that is no longer obvious is still the operator's own
  prompt. It refuses only when nothing can be addressed, and that set is decided by one L1 function,
  `nextStep.ts#tapTargetOf(request, coordinator)` (F16), which the L4 tap only calls:
  - `not-found`: no such request;
  - `no-owner`: the request is terminal, or has no owner (a parent, or one not routed);
  - `no-coordinator`: the owner's coordinator cannot be resolved, with the reason.

  Then the tap calls `promptSession` (HQ7), the same tail the typed-prompt path calls, on the resolved coordinator. Its
  answers (`unknown-session` for a coordinator whose row is gone, `renewing` while it renews, the draft refusal, a
  refused send) are the route's own words, and the console shows each with its sentence.
- **HQ6. The news line** (slug `next-step-news-is-a-fixed-line`). §5.4: "The server stamps it on the request as news."
  **Recommendation:** after a sent prompt, the branch stamps `NEXT_STEP_NEWS[step]` (for example "The operator asked
  the owner to fix the checks.") through request ids A's `stampRequestNewsInTx`, which is bookkeeping and raises no
  revision. Send first, stamp second: the news says what happened. A stamp that fails after a send answers
  `newsStamped: false`, and the prompt is not sent again. A request that left the open states between the resolve and
  the stamp answers `newsStamped: false` (`not-open`) too.
- **HQ7. One tail for both prompt paths** (slug `next-step-tap-shares-the-prompt-route-tail`; fix round 1, F1). W1a's
  renewal hand-offs write the `renewing` refusal and the `operator-at-programme` mark inline in the prompt route, after
  `knownId` on the path's `:id`. A branch that returned before them would skip all three on the coordinator it
  resolved, or need a second writer of the mark.
  **Recommendation:** Task 3 first moves the route's tail into one function, `server/src/promptSession.ts#promptSession`
  (L4, C3), in a move commit with its characterization tests green before and after:

  ```ts
  promptSession(deps, id, text, opts: { onDraft: 'replace' | 'refuse'; attachments: readonly string[];
    resumeIfOwn?: 'whole' }): Promise<SendPromptAnswer | { ok: false; error: 'unknown-session' | 'renewing' }>
  ```

  It runs `knownId` on `id`, the `renewing` check, `sendPrompt` with the draft rule, the refusal log line and, after a
  sent prompt, `markOperatorPrompt`, in that order. The typed path keeps its own `knownId` as its first line, so a bad
  body on an unknown id still answers 404 as today; the tail's check repeats it, a read with no write. The route's typed path parses its body and calls it; the tap calls
  it with the resolved coordinator, the fixed text, `onDraft: 'refuse'` and no attachments. The mark keeps one writer,
  W1a's call, now inside `promptSession`. Task 3's tests pin that a tap is refused `renewing` and leaves the mark, so a
  later change to either path cannot drop them silently.
- **HQ8. A request's spend** (slug `request-spend-reads-run-spend`). Question 22 as amended: "A request's and a
  programme's spend roll up `run_spend`, recorded once per run at its close by the forecast lane from a reading inside
  the run's window, plus the deduplicated, fresh live readings of open runs, marked attributed. A closed run with no
  measured row counts as unmeasured. The coordinator's own spend is outside."
  **Recommendation:** one summation for both. If forecasts B exports its summation as a function, `requestSpendOf`
  calls it with a request's runs; if it is inline in `portfolioFor`, Task 2 first moves it to
  `server/src/coord/spend.ts#spendOfRuns` in a move commit, with a characterization of `portfolioFor`'s spend cases green
  before and after, then calls it twice. The request's answer is forecasts B's spend shape without `perWaveMedian`:
  `{ total, byClass, attributed: true, runsUnmeasured, coordinatorExcluded: true, classAtClose: true }`.
- **HQ9. The Overlord's own spend** (slug `overlord-spend-is-the-live-reading`). Table 4a's row 1 and §5.6 say the
  readiness line shows it, "a read of what the usage sweep already measures", and no plan produces it.
  **Recommendation:** `overlordSpendOf(reading)` (L1) answers the bound session's live usage reading (`cost` by class,
  and its time) as `{ kind: 'measured', … }`, or `{ kind: 'unmeasured', why }` with `why` one of `unbound`, `absent` and
  `stale`. It is the current generation's figure only, marked so: across generations it would need a stored history,
  which "adds no writer" rules out. `GET /api/overlord/readiness` answers it as an optional `spend` beside
  `ReadinessWire`'s fields; `servedReadiness` and the composition W3's `mayHold` reads are untouched.
- **HQ10. Where the requests' spend and next step are served** (slug `requests-read-carries-spend-and-next-step`). The
  operator's request doors piece owns `GET /api/requests` and says "Spend is home requests A's, so the read carries
  none". Home requests A and that piece have no order between them.
  **Recommendation:** PR A ships the deciders and the facts reader with no door. PR B, which needs the doors piece,
  adds two optional fields to each `RequestListRow`: `spend` and `nextStep` (`{ step, runId, pr, coordinator } |
  { step: null, why }`). The read's handler calls the facts reader once for every listed request. No second read and no new door.
- **HQ11. The request ids and names under each message** (slug `chat-shows-ids-from-requests-and-names-from-the-chat`).
  The index, as ruled: "under each operator message in the chat, the request ids it founded and the names they matched
  (§5.1, §5.3), drawn from the requests read". The requests read carries each row's cited message ids. It carries no
  text, so it cannot carry the names the words matched.
  **Recommendation:**
  - **The ids** come from the requests read: `requestIdsByMessage(rows)` (L1) maps each cited message id to the
    requests that cite it, root requests first. A message whose requests have all left the read (closed more than seven
    days ago) shows none. Keeping a full history would need a second read, which W2 does not need.
  - **The names** come from the chat read, which already holds each message's text. Chat A's `composeChat` gains
    `matched: readonly string[]` on the message arm, from the relay's `citedNamesOf([text], programmeSlugs)`. The chat's
    route gathers the programme slugs once per read. This is chat A's own "W2 adds a field to `ChatEntry`'s message
    arm". In W2 a name is a programme slug, as the relay matches; W5's start door adds project names to the same call.
- **HQ12. "Since you were last here" in W2** (slug `since-request-lines-from-row-times`). Table 4.1b's line 2 holds
  "Requests that changed state, with their evidence". W1's block is composed in the console over server rows, per
  device (`w1-home.md`, question 8). The requests read carries `openedAt`, `closedAt` and `lastNewsAt`, and no time of
  the last move.
  **Recommendation:** `sinceLines` gains request counts from those three times: requests opened, requests that ended
  (with the group each ended in), and requests with news since the device's stamp. Line 1, "Needs you", counts the
  Needs you group. A request whose state moved without news, an opening or an ending is not counted, and the line says
  "news, openings and endings" rather than "changes". A counter that weakened a done test, and a goals version resting
  on a relayed request, need server rows the read does not carry, and stay with W3's server composition of the block.
- **HQ13. Which controls a row draws** (slug `request-controls-from-the-transition-table`). The operator's doors decide
  every tap (`operatorTapPlan`), and a control the table cannot allow would only answer `bad-transition`.
  **Recommendation:** `requestControls(row)` (L1) answers the operator moves `REQUEST_TRANSITIONS` allows from the
  row's state, and hand back only when `takenFrom` is set. It never lists the moves by hand: a test derives the expected
  set from the table for every state. Answer is drawn only on `needs-you`. Answer opens a sheet: the operator writes
  what they want, the sheet sends it as an ordinary chat message through chat A's send, and on a recorded answer taps
  the answer door with the row's revision (the doors piece's OD1). A refusal of the message keeps the draft, as the
  composer does, and taps nothing.
- **HQ14. What a stale tap shows** (slug `request-tap-shows-raced-outcomes`). The doors answer `applied`, `outcomes` and
  `mailed`.
  **Recommendation:** the row's result line says what happened, from an L1 table: "Done" on an applied tap; "Already so"
  on `applied: false`; and, for each raced act, "The Overlord's <kind> came first; yours stands" (`superseded`) or
  "The Overlord had done the same" (`concurred`). `bad-transition` shows the doors piece's sentence with the raced act
  ids. The console never refuses or delays a tap for a revision it read, and re-reads the requests after every answer.
- **HQ15. Seen on an act, and which acts a row shows** (slug `request-row-lists-its-acts`). The act read is per
  programme. §10.2 puts the whole Log on a page of the place, which W2 does not build.
  **Recommendation:** an expanded request row lists the acts on that request from its owner's act read, filtered by
  `requestId` (`actsOfRequest`, L1), newest first, each with its kind, state, outcome and masked summary, and a Seen
  control while `seenAt` is empty. A row with no owner lists none in W2, because the act read takes a programme. The Log
  page, which lists every act, is a later piece.
- **HQ16. The ruling control** (slug `goal-conflict-ruled-from-the-strip`). Index question 17: the operator sees a
  standing pair "on the home's portfolio strip and on the Requests rows it blocks, and rules it from the pair's row
  there."
  **Recommendation:** the strip lists each standing goal conflict under the strip, unruled first, as the read orders
  them, with Rule. A Requests row whose `blockedBy` names a pair says "Waits on a goal conflict: <a> and <b>" and links
  to that pair's row. Rule opens one sheet that renders `GOAL_CONFLICT_CHOICES`' rows (label with `{a}` and `{b}`
  filled from the pair, and the sentence) and posts `{ episode, choice }`. The door works while sign-in is dark and asks
  no step-up, so the sheet adds none. `pair-changed` re-reads the portfolio and says "This conflict changed. Look again
  before ruling." A `blockedBy: 'unreadable'` row says "Goal conflicts: unmeasured", never nothing. An overlap pair is
  shown only as a count on the strip: it is the Overlord's to route, and it has no ruling.
- **HQ17. Gates on what is drawn** (slug `requests-part-under-route-v1`). The doors piece's OD13: "The console draws the
  Requests part only under the word." The ruling door and the portfolio's W2 fields are live at their merge (index
  question 20).
  **Recommendation:** the Requests part, the next-step controls and Seen are drawn only while the server advertises
  `overlord-route-v1` (home A's `serverCaps()`); the strip's health, dates and goal conflicts, and the readiness line's
  spend, are drawn whenever their fields are present, under `overlord-v1` as the place itself is. An absent field draws
  nothing; it never draws as "none" or zero.
- **HQ18. The opening of a request-backed goals version** (slug `goals-opened-is-not-home-requests`). Request ids A
  (its RI10) suggests home requests B record the operator's opening of a goals version that rests on a request, to
  replace its `not-opened`.
  **Recommendation:** not here. It needs a server writer of an "opened" fact, and W2's "since" block is per device and
  composed in the console. W3's server composition of the block (Table 4.1b's line 2) is its home. The index names it
  there.
- **HQ19. What a coordinator does with "Land it"** (slug `land-it-asks-for-the-landing-gate`; ruled, F2). The skill has
  no rule for the operator's "Land it" text, and the tap must never read as leave to skip review.
  **Recommendation:** Task 3 adds one line to the coordinator skill's reference
  `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md`: "An operator's 'Land it (request N, run R, PR #P)'
  prompt asks for the normal landing gate for that run: re-measure the wave-done, rule on the review report, and enqueue
  by the repository's route. It never bypasses review or the verdict." The twenty pinned clauses of `SKILL.md` are not
  touched. The index carries the line (section 8).
- **HQ20. A request's quote** (slug `request-quote-on-the-home`; ruled, F15). The operator request doors' read "never
  carries the operator's words. Home requests B renders a quote from the private store under the request record's hash
  rule."
  **Recommendation:** an operator read, `GET /api/requests/:id/quote` (session-gated, no box token), answers request ids
  B's `attestedQuoteOf` over the request's cited messages: their ids and stored hashes come from
  `overlord_request_messages`, and each text from the private store, where a row whose hash is not the stored one is
  `noLongerOnRecord`. Each store read leaves a ledger line under a new read door, `home-quote`. The answer is masked by
  `maskDeep` as the envelope is. The console reads it only when a row is expanded, keeps it in that row's component
  state, and never writes it to the store's cache, the bus or browser storage. A request with no citation (the
  Overlord's own) answers `{ lines: [] }` and the row says "Opened by the Overlord".

## 2. What exists today

Measured on `main` at `fe887521f`.

| What | Where | What this plan does with it |
|---|---|---|
| The prompt route: `knownId`, the attachment checks, `sendPrompt` with `onDraft`, a 409 on a refused send | `server/src/server.ts` (`app.post('/api/sessions/:id/prompt', …)`) | Its tail moves to `promptSession` in a move commit, and the tap's branch calls the same tail (Task 3, F1) |
| The runs that review a run, and a run's move history | `shared/api.ts#RunSummary` (`kind`, `reviews`, `closedAt`), `#RunRecordEvent`, `#RunRecordAnswer` (`reviewedBy`) | The review facts of Table 1's rows 9 to 11 |
| The coordinator skill's landing step | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | One line on an operator's "Land it" (HQ19) |
| A pull request's state as the console and the server read it: `PrPhase`, `PrChecks` (`null` means no checks configured, `unmeasured` a failed read), `checkNames` | `shared/api.ts#PrState`, `#PrChecks` | `nextStepFor`'s input |
| The PR sweep's line readers: `phaseFor`, `checksFor`, the merge-queue word | `server/src/prstate.ts#phaseFor`, `#queueFor`, `#PrQueueRead` | The facts reader reads the watcher's per-session `PrState` and queue word, never ccd |
| The portfolio reader and its wire, with no spend, health or forecast yet | `server/src/coord/portfolio.ts#portfolioFor`, `shared/portfolio.ts#PortfolioEntry` | Forecasts B widens both; this plan reads them |
| The step-up hook and its one-instance rule | `pwa/src/accounts/useStepUp.ts#useStepUp`, `pwa/src/accounts/ConfirmItsYou.tsx` | Hand back, through the place's one instance (home B) |
| Refusal sentences | `pwa/src/lib/refusalWords.ts#refusalText` | Sentences for `no-owner` and `no-coordinator` |
| The 44 px census: a CSS scrape plus a render per control class | `pwa/test/tap-targets.test.tsx` | Each new control class gains a case |
| The contrast gate | `pwa/test/contrast.test.ts`, over `ui/`'s one auditor | Run; no new colour is written |
| A browser test across widths, skins and themes | `pwa/browser/account-knob.browser.test.ts` (`WIDTHS` 360, 390, 1280, 1920; `SKINS`; `THEMES`) | The model for this plan's browser tests |
| The growth check | `server/test/growthCheck.ts#GROWTH_FILES`, `#GROWTH_LIMIT` (40) | §5 |
| The mutation floors | `server/test/sim/mutation-floors.test.ts#MUTANT_SETS`, `server/test/sim/faceSets.ts` (a console decider's set, by `modulePath`) | The server deciders join directly; the console's through `homeSets.ts` |

**Not on `main`, taken from the plans that build them:** everything named in "The plans this one reads". The pieces
PR A needs are request ids A, home B and forecasts B; PR B also needs PR A, the operator's request doors, act reads A,
overlaps B, home C and chat A.

```mermaid
sequenceDiagram
  participant O as Operator
  participant C as Console
  participant R as Prompt route
  participant T as nextStepTap (L4)
  participant S as Coordinator session
  participant Q as overlord_requests
  O->>C: taps Fix the checks on request 42
  C->>R: POST prompt with nextStep 42 fix-checks
  R->>T: the nextStep branch
  T->>Q: requestById 42, its owner
  T->>T: tapTargetOf, the owner's coordinator, resolved now
  T->>S: promptSession, known id, renewing, sendPrompt, the W1a mark
  S-->>T: sent
  T->>Q: stampRequestNewsInTx with the fixed news line
  R-->>C: ok, sentTo and newsStamped
  C-->>O: Sent to the coordinator
```
*Figure 1. One next-step tap. The text and the news line are the server's fixed lines. The route's shared tail,
`promptSession`, checks the target, refuses while it renews, sends, and writes the `operator-at-programme` mark. No
`operator_messages` row is made.*

```mermaid
flowchart TD
  RR["GET /api/requests<br/>rows with group, spend, nextStep, blockedBy"] --> ST["the overlord store"]
  BUS["bus topic requests"] --> ST
  PF["GET /api/portfolio<br/>entries and pairs"] --> ST
  AR["GET /api/acts per owner"] --> ST
  RD["GET /api/overlord/readiness<br/>with spend"] --> ST
  CH["GET /api/overlord/chat<br/>with matched"] --> CT["the chat"]
  ST --> RP["Requests part, Table 4b's groups"]
  ST --> PS["portfolio strip, health, 85% date, goal conflicts"]
  ST --> RL["readiness line, its own spend"]
  ST --> SN["since you were last here"]
  RR --> CT
  RP --> DOORS["the operator's request doors, Seen, next steps"]
  PS --> RULE["Rule a pair"]
```
*Figure 2. What the home reads in W2. Every control is drawn from a server row.*

## 3. Global constraints

- **Architecture (`CLAUDE.md`).**
  - **Decide in L1, act in L4.** `nextStepFor`, `tapTargetOf`, `spendOfRuns` and `overlordSpendOf` are pure.
    `nextStepTap.ts` and the route branch parse, resolve, send through `promptSession` and stamp; the refusal set is
    `tapTargetOf`'s (F16). In the console, `requestsWords.ts`, `requestControls.ts`, the words
    modules and `chatWords.ts` decide; the parts and the store only draw and call.
  - **One writer per fact.** The tap writes the request's news only through `stampRequestNewsInTx`. It writes no mark of
    its own: the mark's one writer is W1a's call, inside the shared tail (HQ7). It writes no message row. The console
    writes nothing but through the doors.
  - **No operator words in `coord.db`, the requests read or the bus.** The quote is read from the private store on
    demand and lives only in the expanded row (HQ20).
  - **Consolidate.** One spend summation for programmes and requests (HQ8). One name matcher, the relay's (HQ11). One
    requests read, the doors piece's, widened (HQ10). The prompt route is the tap's door, with no new route, and one
    tail serves both its paths (HQ7). One quote renderer, request ids B's `attestedQuoteOf` (HQ20).
  - **No overloaded null.** `nextStepFor` answers none with its reason. Spend is `measured` or `unmeasured` with its
    reason, never 0 for unread. `blockedBy` is a list or `'unreadable'`. An absent wire field draws nothing.
  - **Rings.** `shared/nextSteps.ts` imports nothing. `nextStep.ts` and `spend.ts` import `shared/` only. The console's
    L1 modules import no hook, store or `lib/api.ts`.
- **Authority.** A next-step tap is the operator typing to a coordinator, so it takes no step-up (the prompt route takes
  none). Hand back takes the step-up its door asks (the doors piece's OD4); the console runs every door tap through the
  place's one `useStepUp` and shows the step only when a door answers `step-up-required`, never deciding the direction
  itself (W1 home C's rule). The ruling door asks none.
- **H18.** The console sends the revision it read, never refuses or delays its own tap for a revision, and re-reads after
  every answer.
- **Wire: additive.** `RequestListRow` gains `spend?` and `nextStep?`; the readiness answer gains `spend?`;
  `ChatEntry`'s message arm gains `matched?`. An older console ignores them, and an older server's absence draws nothing.
- **What a merge arms.** PR A: the prompt route accepts a `nextStep` body, which nothing sends yet; the readiness answer
  carries the Overlord's spend. PR B: under `overlord-route-v1` the Requests part and its controls; under `overlord-v1`
  the strip's health, dates and goal conflicts, the readiness spend and the chat's ids and names. Nothing a running
  session reads changes, except a coordinator that receives the operator's tap as a typed prompt.
- **Phone first.** Every new part laid out for 360 px with no horizontal scroll. Every control at least 44 px
  (`--tap-min`), each class pinned by a scrape and a render case in `pwa/test/tap-targets.test.tsx`. Long request news
  and summaries wrap; ids and slugs break anywhere.
- **Design system.** Colours, spacing and type from `@ccrc/ui`'s tokens. Health words and group headings use the design
  system's status label. No hex value is written and no generated palette is edited, so the contrast gate
  (`pwa/test/contrast.test.ts`) rules on the result unchanged.
- **Untrusted text.** A request's news and summary, an act's summary and a coordinator's session name are drawn as plain
  text, never as Markdown or HTML, and never as a control's label.
- **SAFETY.** No ccd verb, no fleet act, no live `~/.ccrc`. Server tests build `coord.db` in memory and stub
  `sendPrompt`; no test types into a real pane.
- **Tests.**
  - From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`, one file at a time, in the
    foreground.
  - From `pwa/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts` and
    `ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<file>.browser.test.ts`.
  - Each task ends with the typechecks it touches: in `server/`, `ccrc test -- npx tsc --noEmit -p tsconfig.json` and
    `-p test/tsconfig.tests.json`; in `pwa/`, `ccrc test -- npx tsc --noEmit`.
  - PR B's last task runs the whole pwa suite and the whole browser suite before the push, and the server's
    `single-definition` and `topology-clean`, because a console change can red a server scan.
- **Growth check.** Every growth-checked file stays within 40 net lines in each pull request, with no waiver (§5).
- **Mutation floors.** Server deciders join `MUTANT_SETS` with their floors in the pull request that creates them. The
  console's deciders join `server/test/sim/homeSets.ts`, home A's set file, by `modulePath`. Tables get a totality
  test instead.
- **Public repository.** Fixtures use `prog-a`, `prog-b`, `lane-a-coordinator`, `lane-b-coordinator` and
  `lane-a-overlord`. No private name. No D-number is invented. The seven-day Done window is the read's, and no
  seven-day millisecond literal is written here (`token-shared.test.ts` allows one in the shipped roots).

## 4. Review focus

1. A next-step control appears only from measured facts, never for several PRs, a sibling run whose PR state is not
   measured, or an `absent` queue word; "Land it" only after a measured accept; "Address the comments" never in W2.
2. A tap sends only a fixed text naming the request, the run and its PR, to the owner's coordinator as resolved at the
   tap, through the same tail as a typed prompt (known id, `renewing`, the draft rule, the mark); it stamps one fixed
   news line and writes no message row.
3. The quote is the private store's, rendered by `attestedQuoteOf`, never stored or cached outside the expanded row.
4. Spend never reads an unmeasured run as 0, and programmes and requests use one summation.
5. No console tap is refused or delayed for a revision; every answer, outcome and refusal is shown.
6. Every control is drawn from a server row or table (`REQUEST_TRANSITIONS`, `GOAL_CONFLICT_CHOICES`), never from a list
   in the console.
7. 360 px with no horizontal scroll, 44 px targets, and the contrast gate unchanged.

## 5. The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate (net lines) |
|---|---|---|---|---|
| A, next steps, the tap and spend | 1 to 3 | `shared/nextSteps.ts`; `nextStepFor` and `tapTargetOf`; `spendOfRuns` and `overlordSpendOf`; the facts reader with the review facts; `promptSession`, the route's tail moved out; the tap's branch and its module; the coordinator skill's "Land it" line; the Overlord's spend on the readiness read | request ids A, home B, forecasts B, W1a hand-offs (#2934, whose `renewing` check and mark the move carries) | `server/src/server.ts` about -3 net: the move commit takes the tail out (six lines on `main` at `fe887521f`, about ten once W1a's `renewing` check and mark are in) and adds the call and its import (+3), about -7; the branch commit adds about +4 (the branch and `tapNextStep`'s import). Measured again at build time, on top of W1a; `server/src/coord/store.ts` +3 (one delegate, only if the facts reader needs a store reader for the review facts or the spend rows that no producer ships); `server/src/coord/routes.ts` 0; `shared/api.ts` 0; `pwa/src/lib/api.ts` 0 |
| B, the console | 4 to 10 | The requests read's `spend` and `nextStep`; the chat read's `matched`; the Requests part with its controls and Seen; a request's quote; goal conflicts on the strip and rows with the ruling sheet; the strip's health and 85% date; the readiness spend; the chat's ids and names; "since you were last here" | PR A, the operator's request doors, act reads A, overlaps B, forecasts B, home C, chat A, request ids B | `pwa/src/lib/api.ts` +16 (`tapNextStep` about 4, `requestQuote` about 4, `rulePair` about 4, the widened answer types about 4); `server/src/server.ts` 0; `server/src/coord/store.ts` 0; `shared/api.ts` 0 |

**If a PR cannot fit.** PR B's `pwa/src/lib/api.ts` estimate leaves room under 40 because the doors piece and act reads
A ship their own client calls. If it passes 40 at build time (for example because another lane F piece landed first in
the same file), the ruling sheet and `rulePair` move to a further pull request, B2, after B, with Task 8. No waiver is
planned.

For scale, the files that are not growth-checked change by about this much:

| File | PR A | PR B |
|---|---|---|
| `shared/nextSteps.ts` | +60, new | |
| `server/src/coord/nextStep.ts`, `spend.ts`, `requestFacts.ts`, `nextStepTap.ts`, `server/src/promptSession.ts` | +330, new | |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | +4 | |
| `server/src/coord/overlordRoutes.ts` | +10 | +12 |
| `server/src/coord/requestRoutes.ts`, `shared/overlordRequests.ts`, `shared/overlordChat.ts` | | +60 |
| `pwa/src/overlord/` new L1 modules and parts | | +700, new |
| `pwa/src/overlord/` home B's and chat A's modules | | +160 |
| `pwa/src/stores/overlord.ts` | | +70 |
| `pwa/src/overlord/overlord.css` | | +120 |
| `pwa/src/lib/refusalWords.ts` | | +8 |
| Server tests | +600 | +200 |
| Console tests and browser tests | | +900 |
| `server/test/sim/homeSets.ts` and the server sets | +80 | +160 |

## 6. Tasks

### Task 1: The three texts and `nextStepFor` (PR A; L0, L1)

**Files:**
- Create: `shared/nextSteps.ts` (`NEXT_STEP_MAP` with `fix-checks`, `address-comments`, `land-it`, each `{ label, prompt,
  news }`; `NEXT_STEPS` derived; `isNextStep`; `nextStepPrompt(step, { requestId, runId, pr })`; `NEXT_STEP_NONE_MAP`
  with the six reasons of Table 1, and its derived list)
- Create: `server/src/coord/nextStep.ts` (`nextStepFor`; `tapTargetOf`, the tap's refusal set, F16)
- Create: `server/test/next-step.test.ts`, `server/test/next-step-cases.ts`
- Modify: `server/test/sim/mutation-floors.test.ts` (`MUTANT_SETS` gains `nextStepFor`), `mutation-floors.json`
- Modify: the architecture spec's path table (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`): C5
  gains `shared/nextSteps.ts` and `server/src/coord/nextStep.ts`

**Interfaces:**

```ts
// shared/nextSteps.ts (L0, C5). Imports nothing.
export const NEXT_STEP_MAP = {
  'fix-checks': { label: 'Fix the checks', prompt: 'Fix the checks', news: 'The operator asked the owner to fix the checks.' },
  'address-comments': { label: 'Address the comments', prompt: 'Address the comments', news: 'The operator asked the owner to address the comments.' },
  'land-it': { label: 'Land it', prompt: 'Land it', news: 'The operator asked the owner to land it.' },
} as const;
export type NextStep = keyof typeof NEXT_STEP_MAP;
export const NEXT_STEPS: readonly NextStep[];
export function isNextStep(v: unknown): v is NextStep;
/** The one text a tap sends: the step's prompt, the request, the run and its PR (F2).
 *  `pr: null` writes "PR not measured" in the PR's place. */
export function nextStepPrompt(step: NextStep,
  at: { readonly requestId: number; readonly runId: number; readonly pr: number | null }): string;
export type NextStepNone =
  'not-in-progress' | 'no-pr' | 'several-prs' | 'pr-unmeasured' | 'review-pending' | 'none-obvious';

// server/src/coord/nextStep.ts (L1, C5). Imports shared/ only.
export interface NextStepRun {
  readonly runId: number;
  readonly runState: RunState;
  readonly pr: { readonly state: PrState; readonly queue: PrQueue | 'absent' } | 'unmeasured';
  /** When the run last entered `awaiting-review`, and its latest review run (F2). */
  readonly review: { readonly enteredReviewAt: number | null;
    readonly latest: { readonly state: RunState; readonly closedAt: number | null } | null } | 'unmeasured';
}
export interface NextStepInput {
  readonly requestState: RequestState;
  readonly runs: readonly NextStepRun[];
  /** Review comments waiting on the one PR. W2 always passes 'unmeasured' (HQ2). */
  readonly comments: 'waiting' | 'none' | 'unmeasured';
}
export function nextStepFor(input: NextStepInput):
  { readonly step: NextStep; readonly runId: number; readonly pr: number }
  | { readonly step: null; readonly why: NextStepNone };

/** The tap's refusal set (HQ5), decided here so the L4 tap only calls it. */
export function tapTargetOf(request: RequestRow | 'absent',
  coordinator: { readonly sessionId: string } | { readonly unresolved: string }):
  { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly error: 'not-found' | 'no-owner' | 'no-coordinator'; readonly detail?: string };
```

- [ ] **Step 1: Failing tests** (`next-step.test.ts`, cases in `next-step-cases.ts`):
  - each row of Table 1, with the row above it just failing, so the first match is pinned;
  - exhaustiveness: every `RequestState` × every `PrPhase` × every `PrChecks` × each queue word × four run states
    (`working`, `awaiting-review`, `merging`, `done`) × each review fact answers a step or a reason, and never throws;
  - monotonicity: adding a second open PR to any input that offered a step answers `several-prs`; adding a sibling run
    whose PR reading is `unmeasured`, `unknown` or `unchecked` to any input that offered a step answers `pr-unmeasured`
    (F5); changing a `pass` to `unmeasured` never offers `land-it`;
  - one failing open PR beside an unmeasured sibling answers `pr-unmeasured`, not `fix-checks`; one green PR beside one
    answers `pr-unmeasured`, not `land-it` (F5's two cases);
  - the queue word `absent` with everything else green and accepted answers `pr-unmeasured`;
  - "Land it" and review (F2): `awaiting-review` with no review run answers `review-pending`; with an open review run,
    `review-pending`; with a `failed` one, `review-pending`; with a `done` one closed before the run last entered
    `awaiting-review` (an old round, after a send-back), `review-pending`; with a `done` one closed at or after it,
    `land-it`; `merging` answers `land-it` whatever the review facts; review facts `unmeasured` answer `pr-unmeasured`;
    `working` never answers `land-it`;
  - `comments: 'waiting'` offers `address-comments` only below row 6, and `comments: 'unmeasured'` never offers it;
  - `null` checks never offer `land-it`;
  - a step answer carries the one open PR's run id and number;
  - `nextStepPrompt('land-it', { requestId: 42, runId: 7, pr: 123 })` is exactly
    `Land it (request 42, run 7, PR #123).`, with `pr: null` it is `Land it (request 42, run 7, PR not measured).`, and
    each step's prompt starts with its label;
  - the texts are exactly §5.4's three labels (a pin against the spec's words);
  - `tapTargetOf`: an absent request is `not-found`; each terminal state, a parent and an unrouted row is `no-owner`; an
    unresolved coordinator is `no-coordinator` with its reason; an owned, open request with a resolved coordinator is
    `ok` with its session (F16).
- [ ] **Step 2: Run.** `ccrc test -- ./node_modules/.bin/vitest run test/next-step.test.ts`. Red.
- [ ] **Step 3: Implement.** **Step 4: Run.** Green, and the three typechecks.
- [ ] **Step 5: Mutation.** Join `MUTANT_SETS` (`nextStepFor` and `tapTargetOf`) and run the floors test. Named mutants
  that must be killed: N1 offer `land-it` on `null` checks; N2 take the first of several PRs; N3 offer a step on
  `needs-you`; N4 read `unmeasured` checks as `pass`; N5 offer `land-it` while queued; N6 offer `land-it` on queue word
  `absent`; N7 move row 2 below rows 3 and 4 (only open and draft PRs counted); N8 offer `land-it` on `awaiting-review`
  without a review fact; N9 accept a review closed before the run last entered `awaiting-review`; N10 accept a `failed`
  review; N11 answer `no-owner` for an unresolved coordinator. Record the floors.
- [ ] **Step 6: Commit.** `feat(overlord): the next-step texts and the decider that offers one (Overlord W2 home requests A)`

### Task 2: Spend and the facts reader (PR A; L1, L3)

**Files:**
- Create: `server/src/coord/spend.ts` (`spendOfRuns`, or forecasts B's summation moved here; `overlordSpendOf`)
- Create: `server/src/coord/requestFacts.ts` (`requestFacts(deps, requestIds)`: each request's linked runs from
  `runs.requestId`, each run's state, its session's `PrState` and queue word from the watcher's listing, its review
  facts (the time of its last move into `awaiting-review` from its run events, and its latest review run's state and
  `closedAt`, from the store's reader of the runs that review it, the one behind `RunRecordAnswer#reviewedBy`), the
  `run_spend` rows through forecasts B's store read, and the live usage readings through forecasts B's usage port)
- Modify: `server/src/coord/portfolio.ts` (only if the summation moves: `portfolioFor` calls `spendOfRuns`), with a
  characterization first
- Modify: `server/src/coord/overlordRoutes.ts` (`GET /api/overlord/readiness` answers `spend` beside `ReadinessWire`),
  `shared/overlordRequests.ts` (`RequestSpend`), the readiness piece's shared file (`OverlordSpendWire`)
- Create: `server/test/request-spend.test.ts`, `server/test/request-facts.test.ts`
- Modify: `MUTANT_SETS` and `mutation-floors.json` (`spendOfRuns` if new here, `overlordSpendOf`),
  `server/test/single-definition/time-ports.test.ts` only if `requestFacts.ts` reads a clock (it should take `now`)

**Interfaces:**

```ts
// server/src/coord/spend.ts (L1, C5)
export function spendOfRuns(runs: readonly SpendRun[], rows: readonly RunSpendRow[],
  live: readonly LiveReading[]): RequestSpend;   // forecasts B's rules, one place
export function overlordSpendOf(reading: LiveReading | 'absent' | 'stale', bound: boolean):
  { kind: 'measured'; cost: number; byClass: Readonly<Record<string, number>>; at: number; scope: 'generation' }
  | { kind: 'unmeasured'; why: 'unbound' | 'absent' | 'stale' };

// server/src/coord/requestFacts.ts (L3, C5)
export function requestFacts(deps: RequestFactsDeps, requestIds: readonly number[]):
  { ok: true; byRequest: ReadonlyMap<number, { nextStepInput: NextStepInput; spend: RequestSpend }> }
  | { ok: false; reason: string };
```

- [ ] **Step 1: Characterize** (only if the summation moves): `portfolioFor`'s spend cases from forecasts B, green on
  `main` against its code. The move commit changes only that test's imports.
- [ ] **Step 2: Failing tests:**
  - `request-spend.test.ts`: a request with two closed runs (one `measured`, one `absent`) and one open run with a fresh
    reading sums the measured row and the live reading, and counts one unmeasured; an `outside` row and a closed run
    with no row each count as unmeasured, never 0; a session shared by two open runs counts once; a `stale` live reading
    counts as unmeasured; the coordinator's session is never summed; the same inputs grouped by programme answer exactly
    what `portfolioFor`'s spend answers (one summation);
  - `overlordSpendOf`: an unbound designation answers `unbound`; no reading `absent`; a stale one `stale`; a reading
    answers `measured` with `scope: 'generation'`;
  - `request-facts.test.ts`, over an in-memory `coord.db` and stub watcher reads: a request's runs come only from
    `runs.requestId`; a run whose session has no PR reading gives `pr: 'unmeasured'`; `comments` is always
    `'unmeasured'`; a store read that throws answers `{ ok: false }`, never an empty map;
  - the review facts: a run with two review runs reports the higher id's state and `closedAt`; a run sent back and
    advanced again reports the later `awaiting-review` time; a run reviewed by nothing reports `latest: null`; a failed
    read of the run events or of the review runs gives that run `review: 'unmeasured'`, never `latest: null`;
  - the readiness read answers `spend` beside an unchanged `ReadinessWire` (each W1 field equal to the readiness piece's
    own case), and `servedReadiness` is not called twice.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green; then forecasts B's portfolio suites, the
  readiness suites and the typechecks.
- [ ] **Step 6: Mutation.** S1 read `absent` as 0; S2 count a shared session twice; S3 sum the coordinator's session;
  S4 answer `measured` for a stale reading. Each killed. Record the floors.
- [ ] **Step 7: Commit.** `feat(overlord): what each request cost, and the Overlord's own spend on the readiness read (Overlord W2 home requests A)`

### Task 3: The prompt route's tail, then the tap (PR A; L4)

**Files:**
- Create: `server/src/promptSession.ts` (`promptSession(deps, id, text, opts)`: `knownId` on `id`, the `renewing`
  check, `sendPrompt` with the draft rule and attachments, the refusal log line, and `markOperatorPrompt` after a sent
  prompt; HQ7, F1)
- Create: `server/test/prompt-session-characterize.test.ts` (the prompt route's answers before and after the move)
- Create: `server/src/coord/nextStepTap.ts` (`tapNextStep(deps, pathId, body)`: parse, read the request and the run,
  resolve the owner's coordinator, `tapTargetOf`, `promptSession`, stamp; the deps are `promptSession`, `requestById`,
  `programmeCoordinator`, the run reader, the watcher's PR reading, `stampRequestNewsInTx` inside a coordination
  transaction, and `now`)
- Modify: `server/src/server.ts` (the move commit: the route's tail becomes one `promptSession` call; the branch
  commit: `if (body.nextStep !== undefined) return …tapNextStep(…)` before `knownId`, with its import)
- Modify: `shared/refusal.ts` (`no-owner` and `no-coordinator` in the prompt route's refusal group, with their
  statuses), `pwa/src/lib/refusalWords.ts` (their sentences), `server/test/single-definition/refusal-table.data.json`
- Modify: `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` (HQ19's line)
- Modify: the architecture spec's path table: C3 gains `server/src/promptSession.ts`, C5 `nextStepTap.ts`
- Create: `server/test/next-step-tap.test.ts`

- [ ] **Step 1: Characterize, on `main` plus W1a hand-offs** (`prompt-session-characterize.test.ts`, the prompt route
  on a real Fastify instance with `sendPrompt` stubbed and an in-memory `coord.db`): an unknown id answers 404
  `unknown-session`, also with a bad attachment; each attachment refusal; an empty text; a refused draft (409); a
  replaced draft; `resume: true`; a renewing session answers `renewing` and calls no `sendPrompt`; a sent prompt into a
  programme's coordinator leaves `operator-at-programme`, and a refused one leaves none; the refusal log line's shape.
  Run: green against today's inline code.
- [ ] **Step 2: Move.** Move the tail into `promptSession` and call it from the route. The move commit changes only that
  test's imports, if any. Run the characterization and every existing prompt route suite: green, unchanged.
- [ ] **Step 3: Commit the move.** `refactor(server): the prompt route's tail moves to promptSession, unchanged (Overlord W2 home requests A)`
- [ ] **Step 4: Failing tests** (`next-step-tap.test.ts`, the same harness):
  - a tap `{ requestId: 42, runId: 7, step: 'fix-checks' }` for request 42 owned by `prog-a`, run 7 with PR #123, sends
    exactly `Fix the checks (request 42, run 7, PR #123).` to `prog-a`'s coordinator, stamps `lastNewsAt` and the fixed
    news line, leaves the request's `revision` unchanged, and answers `sentTo`;
  - with no PR reading for run 7's session at the tap, the text says `PR not measured`;
  - with `:id` naming `lane-b-coordinator` while the owner is `prog-a`, the tap goes to `prog-a`'s coordinator and
    `sentTo` says so (HQ5);
  - the tap sends even when `nextStepFor` would now offer nothing (the decider is not re-run);
  - `not-found`, `no-owner` (terminal, parent and unrouted rows) and `no-coordinator` each send nothing and stamp
    nothing;
  - a body with both `text` and `nextStep`, an unknown step, a non-integer id, or a `runId` whose run does not carry
    the request's id is `bad-request`;
  - through `promptSession` (F1): a resolved coordinator whose registry row is gone answers `unknown-session`; one that
    is renewing answers `renewing` and calls no `sendPrompt`; a draft in its box answers the draft refusal; each with
    its own words, and nothing is stamped;
  - a stamp that throws after a send answers `newsStamped: false` and sends once;
  - no row is written to `operator_messages` (the private store is checked, when present) and no inbox row appears;
  - after a tap into a coordinator of `prog-a`, `operator_marks` holds `prog-a`'s mark, written once, by the call inside
    `promptSession` (HQ7);
  - a body without `nextStep` takes today's path: the characterization stays green;
  - the skill reference holds HQ19's line (a text pin in the test, beside the coordinator skill's own pins).
- [ ] **Step 5: Run.** Red. **Step 6: Implement.** **Step 7: Run.** Green; then the characterization, the existing
  prompt route suites, the refusal-table suite, `coordinator-skill`, `growth-check` and the typechecks.
- [ ] **Step 8: Red check.** Re-run the decider at the tap: the "sends anyway" case reds. Send to `:id`: the moved-owner
  case reds. Take the text from the body: the `bad-request` case reds. Call `sendPrompt` directly instead of
  `promptSession`: the `renewing` and mark cases red. Decide `no-owner` in `nextStepTap.ts` instead of calling
  `tapTargetOf`: the census of the refusal set (a scan that `nextStepTap.ts` names no refusal word but through
  `tapTargetOf`) reds. Each reverted.
- [ ] **Step 9: The last runs for PR A:** the docs guards (`anchors`, `citations`, `dtbd`, `docs-grammar`,
  `topology-clean`, and `deviation-refs` after `git fetch origin main`), `growth-check`, `single-definition/*.test.ts`,
  `rings/*.test.ts`, the mutation floors, the typechecks in `server/` and `pwa/`.
- [ ] **Step 10: Commit, then push once.** `feat(overlord): a next-step tap is the operator's prompt to the owning coordinator (Overlord W2 home requests A)`

### Task 4: The requests read carries spend and the next step; the chat read carries names (PR B; L4)

**Files:**
- Modify: `server/src/coord/requestRoutes.ts` (the requests read calls `requestFacts` once for the listed ids, then
  `nextStepFor` per row, and adds `spend` and `nextStep` with the owner's coordinator)
- Modify: `shared/overlordRequests.ts` (`RequestListRow` gains `spend?` and `nextStep?`)
- Modify: `server/src/coord/overlordChat.ts` (`composeChat` passes `matched`), `server/src/coord/overlordRoutes.ts` (the
  chat read gathers the programme slugs once), `shared/overlordChat.ts` (`ChatEntry`'s message arm gains `matched?`)
- Modify: `server/test/operator-requests-read.test.ts` (the doors piece's), the chat read suite (chat A's)

- [ ] **Step 1: Failing tests:**
  - each listed row carries `spend` from `requestFacts` and `nextStep` from `nextStepFor` with its coordinator; a facts
    read that fails gives every row `spend: { kind: 'unmeasured', why: 'read-failed' }` and `nextStep: { step: null,
    why: 'pr-unmeasured' }`, and the read still answers;
  - `requestFacts` is called once per read, not once per row;
  - a chat message naming `prog-a` and an everyday word carries `matched: ['prog-a']`; a name under four characters and
    `overlord` never match (the relay's own cases, through the same function);
  - the chat read gathers the programme slugs once per read.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green, and the typechecks in `server/` and `pwa/`.
- [ ] **Step 5: Commit.** `feat(overlord): the requests read carries spend and the next step, the chat read the matched names (Overlord W2 home requests B)`

### Task 5: The Requests part (PR B; L1, L4)

**Files:**
- Create: `pwa/src/overlord/requestsWords.ts` (L1: group headings from `REQUEST_GROUP_MAP`, `requestRowLine` (owner,
  news, age, spend), `ageWords`, `spendWords` with "attributed" and the unmeasured count, `nextStepWords` from
  `NEXT_STEP_MAP`)
- Create: `pwa/src/overlord/RequestsPart.tsx`, `pwa/src/overlord/RequestRow.tsx`
- Modify: `pwa/src/overlord/OverlordPlace.tsx` (mount part 6 between the capacity line and the chat, under
  `overlord-route-v1`), `pwa/src/stores/overlord.ts` (a `ReadState` of the requests read, re-read on the `requests`
  topic and after every tap), `pwa/src/lib/api.ts` (`tapNextStep(sessionId, requestId, runId, step)`)
- Modify: `pwa/src/overlord/overlord.css`
- Create: `pwa/test/overlord-requests-part.test.tsx`, `pwa/test/requests-words.test.ts`
- Modify: `server/test/sim/homeSets.ts` (`requestRowLine`, `spendWords`), `pwa/test/tap-targets.test.tsx`

- [ ] **Step 1: Failing tests:**
  - the groups appear in `REQUEST_GROUP_MAP`'s order with their headings, and an empty group is not drawn;
  - a row shows its owner, its news line as plain text (a fixture's news holding `<b>` and `**x**` is drawn verbatim),
    its age, and its spend; unmeasured spend says how many runs were not measured, never `0`;
  - a row with `nextStep.step` draws one button with the step's label and "run <runId>, PR #<pr>" beside it; tapping it
    calls `tapNextStep` once with the coordinator and the run id from the row and shows "Sent to <sentTo>"; a refusal
    shows its sentence; a row whose `why` is `review-pending` says "Waits for its review";
  - without `overlord-route-v1` nothing of the part is drawn; a failed read says "Requests: unmeasured", never an empty
    list;
  - the store re-reads on the `requests` topic and after a tap, and keeps the last good read beside a failure;
  - the button's class has a scrape and a render case in `tap-targets.test.tsx`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green, and pwa's `tsc`.
- [ ] **Step 5: Mutation.** The new deciders join `homeSets.ts` by `modulePath`; mutants R1 read unmeasured spend as 0,
  R2 drop the attributed mark, R3 draw an empty group. Each killed; the floors recorded.
- [ ] **Step 6: Commit.** `feat(pwa): the Requests part in Table 4b's groups, with next steps (Overlord W2 home requests B)`

### Task 6: The operator's request doors and Seen on the rows (PR B; L1, L4)

**Files:**
- Create: `pwa/src/overlord/requestControls.ts` (L1: `requestControls(row)` from `REQUEST_TRANSITIONS`;
  `tapResultWords(answer)` (HQ14); `actsOfRequest(acts, requestId)`)
- Create: `pwa/src/overlord/AnswerSheet.tsx`
- Modify: `pwa/src/overlord/RequestRow.tsx` (the door controls, the result line, the expanded acts with Seen),
  `pwa/src/stores/overlord.ts` (the owner's act read, on expanding a row)
- Create: `pwa/test/overlord-request-controls.test.tsx`, `pwa/test/request-controls.test.ts`
- Modify: `server/test/sim/homeSets.ts` (`requestControls`, `tapResultWords`, `actsOfRequest`),
  `pwa/test/tap-targets.test.tsx`

- [ ] **Step 1: Failing tests:**
  - for every request state, `requestControls` answers exactly the operator moves `REQUEST_TRANSITIONS` allows from it,
    hand back only with `takenFrom` set, answer only on `needs-you` (the expected set derived from the table in the
    test, never listed by hand);
  - each control calls its door once with the row's `revision`; hand back goes through the place's `useStepUp` and acts
    once after the step; the others never show the step;
  - an answer with `applied: false` says "Already so"; each `superseded` and `concurred` outcome shows its line; a
    `bad-transition` shows the doors' sentence with the raced act ids; after every answer the requests are re-read;
  - a tap is never held back because the store's revision is older than the server's (a fixture serves a newer revision
    on the re-read: the first tap was still sent with the older one);
  - the answer sheet sends the message through chat A's send first; on a recorded answer it taps the answer door; on a
    refusal it keeps the draft and taps nothing;
  - expanding a row with an owner lists that request's acts, newest first, each with Seen while `seenAt` is empty;
    Seen calls the door once and draws the act as seen; a row with no owner lists no acts and says why;
  - an act's summary is drawn as plain text.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green, and pwa's `tsc`.
- [ ] **Step 5: Mutation.** C1 list hand back without `takenFrom`; C2 draw answer outside `needs-you`; C3 read
  `superseded` as `concurred`; C4 skip the re-read. Each killed; floors recorded.
- [ ] **Step 6: Commit.** `feat(pwa): the operator's request doors and Seen on each request (Overlord W2 home requests B)`

### Task 7: A request's quote (PR B; L4, C11 reads)

**Files:**
- Modify: `server/src/coord/requestRoutes.ts` (`GET /api/requests/:id/quote`: the request's cited ids and stored
  hashes from `overlord_request_messages` through the request store, one private-store read per id, `attestedQuoteOf`,
  `maskDeep`; HQ20), the private store's `READ_DOOR_MAP` (a `home-quote` read door)
- Modify: the census that pins the doors piece's operator doors in that file (its hand-kept list, both directions), and
  `auth/gate.ts`'s tests (the read is session-gated, not EXEMPT)
- Modify: `pwa/src/lib/api.ts` (`requestQuote(id)`), `pwa/src/overlord/RequestRow.tsx` (the quote in the expanded row,
  in its own component state), `pwa/src/overlord/requestsWords.ts` (`quoteLineWords`: the words for `withdrawn`,
  `noLongerOnRecord` and `unmeasured`)
- Create: `server/test/request-quote-read.test.ts`, `pwa/test/overlord-request-quote.test.tsx`
- Modify: `server/test/sim/homeSets.ts` (`quoteLineWords`)

- [ ] **Step 1: Failing tests:**
  - `request-quote-read.test.ts`, over an in-memory `coord.db` and a private store in a fixture directory: a request
    citing two messages answers both texts with their ids and times, root first; a message whose stored text was changed
    after the citation (its hash no longer the stored one) answers `noLongerOnRecord`, never its new text; a `gone` row
    answers `withdrawn`; a store read that throws answers `unmeasured` for that id, never `withdrawn`; each read leaves
    one ledger line under `home-quote`; a request with no citation answers `lines: []`; an unknown id is `not-found`;
    the answer is masked (a planted secret-shaped string in a stored text comes back masked);
  - the no-private-words case: after a quote read, no table of `coord.db` holds the quoted text (a scan of every text
    column), the requests read and the `requests` bus frame carry none of it, and the server log holds none of it;
  - `overlord-request-quote.test.tsx`: expanding a row calls `requestQuote` once and draws each line as plain text (a
    text holding `<b>` and `**x**` is drawn verbatim); each non-text line shows its words; a failed read says "Quote
    unmeasured"; collapsing the row drops the quote, and nothing of it reaches the store's state or `localStorage`; a
    row of the Overlord's own says "Opened by the Overlord".
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green; then the census, `auth-gate`, the private
  store's suites and the typechecks.
- [ ] **Step 5: Mutation.** Q1 render a changed message's new text; Q2 read a failed store read as `withdrawn`; Q3 keep
  the quote in the store's cache. Each killed; floors recorded.
- [ ] **Step 6: Commit.** `feat(overlord): a request's quote, from the private store, on the expanded row (Overlord W2 home requests B)`

### Task 8: Goal conflicts on the strip and the rows, and the ruling sheet (PR B; L1, L4)

**Files:**
- Modify: `pwa/src/overlord/portfolioWords.ts` (home B's: `healthLine` with the word as a status label and its evidence
  on demand, `dateLine` with the 85% date, its `unforecastable` reason and the "uncalibrated" mark, `pairLine`)
- Modify: `pwa/src/overlord/PortfolioStrip.tsx` (health, the 85% date, the standing goal conflicts with Rule, an
  overlap count)
- Create: `pwa/src/overlord/GoalConflictSheet.tsx`
- Modify: `pwa/src/overlord/RequestRow.tsx` (`blockedBy`'s line and its link to the pair's row)
- Modify: `pwa/src/lib/api.ts` (`rulePair(key, body)`, reading a 404 as "this server rules no pairs"; the portfolio
  call's answer type widened with `pairs` and `pairRate`)
- Create: `pwa/test/overlord-goal-conflicts.test.tsx`
- Modify: `pwa/test/overlord-portfolio-strip.test.tsx` (home B's), `server/test/sim/homeSets.ts` (`healthLine`,
  `dateLine`), `pwa/test/tap-targets.test.tsx`

- [ ] **Step 1: Failing tests:**
  - the strip shows each programme's health word and its 85% date when present, the `unforecastable` reason when that is
    the answer, "uncalibrated" when the view says so, and nothing for an absent field (never "none" or a dash that reads
    as a value);
  - each standing goal conflict appears once, unruled before ruled as the read orders them, with Rule; overlaps show as
    a count only;
  - the sheet renders every row of `GOAL_CONFLICT_CHOICES` with `{a}` and `{b}` filled, in the table's order, and the
    test passes a fixture table with a fourth row to prove nothing is hard-coded;
  - a choice posts `{ episode, choice }` once; `pair-changed` re-reads and says the conflict changed; a 404 says the
    server rules no pairs; the sheet asks no step-up, signed in or dark;
  - a Requests row whose `blockedBy` names a pair says so and links to that pair's row; `'unreadable'` says "Goal
    conflicts: unmeasured";
  - `pairs: 'unreadable'` on the portfolio read says so on the strip, beside a good strip.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green, and pwa's `tsc`.
- [ ] **Step 5: Mutation.** P1 draw an absent date as a dash value; P2 drop the uncalibrated mark; P3 hard-code the
  choices (the fourth-row case reds). Each killed; floors recorded.
- [ ] **Step 6: Commit.** `feat(pwa): goal conflicts on the portfolio strip and the rows they block, and the ruling sheet (Overlord W2 home requests B)`

### Task 9: The chat's ids and names, the readiness spend, and "since you were last here" (PR B; L1, L4)

**Files:**
- Modify: `pwa/src/overlord/chatWords.ts` (chat A's: `requestIdsByMessage(rows)`), `pwa/src/overlord/OverlordChat.tsx`
  (under each operator message, its request ids as links to their rows, and its `matched` names)
- Modify: `pwa/src/overlord/readinessWords.ts` and `ReadinessPart.tsx` (home B's: the spend line, "this generation",
  or its unmeasured reason)
- Modify: `pwa/src/overlord/sinceWords.ts` (home B's `sinceLines`: the request counts of HQ12)
- Modify: the chat, readiness and since suites (chat A's and home B's), `server/test/sim/homeSets.ts`
  (`requestIdsByMessage`, the widened `sinceLines`)

- [ ] **Step 1: Failing tests:**
  - a message cited by a root and a child request shows both ids, root first; a message no listed request cites shows
    none; a request id links to its row on the place;
  - `matched` names are drawn under the message as plain text; an absent `matched` draws nothing;
  - the readiness part shows the spend with "this generation", or "spend unmeasured: <why>", and nothing when the field
    is absent;
  - `sinceLines` counts requests opened, ended (by group) and with news since the device's stamp, keeps Table 4.1b's
    order and its seven-line cap, and says "unmeasured" when the requests read failed, never "quiet";
  - every existing W1 case of the three suites stays green.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green, and pwa's `tsc`.
- [ ] **Step 5: Mutation.** M1 put a child before its root; M2 read a failed requests read as "quiet"; M3 count a
  closed request as opened. Each killed; floors recorded.
- [ ] **Step 6: Commit.** `feat(pwa): what each message became, the Overlord's own spend and request changes since you were last here (Overlord W2 home requests B)`

### Task 10: The browser runs and the last checks (PR B)

**Files:**
- Create: `pwa/browser/overlord-requests.browser.test.ts` (modelled on `account-knob.browser.test.ts`: `WIDTHS` 360,
  390, 1280, 1920 × both skins × both themes)
- Modify: `pwa/browser/overlord-place.browser.test.ts` (home B's)

- [ ] **Step 1: Failing browser tests:** at each width, skin and theme, the place with every group full, a long news
  line, a goal conflict, an open ruling sheet and an open answer sheet has no horizontal scroll; every control (the
  next step, each door, Seen, Rule, each choice) measures at least 44 px; the strip's health label and date stay on the
  strip's row at 360 px or wrap without overflow.
- [ ] **Step 2: Run.** `ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/overlord-requests.browser.test.ts`.
  Red where a layout overflows; fix the CSS through tokens; green.
- [ ] **Step 3: The whole suites** (in the foreground): the whole pwa suite, the whole browser suite, and from
  `server/`: `growth-check` (with `pwa/src/lib/api.ts`), `single-definition/*.test.ts`, `topology-clean`, `rings/*`,
  `box-token-census`, `auth-gate`, the mutation floors, the docs guards (`anchors`, `citations`, `dtbd`,
  `docs-grammar`, `deviation-refs` after `git fetch origin main`), and the typechecks. Expected: PASS.
- [ ] **Step 4: Commit.** `test(pwa): the home's requests at every width and skin (Overlord W2 home requests B)`
- [ ] **Step 5: Before the push.** Merge `main` once if another lane F or lane R piece landed in a shared file first
  (worker clause 16), re-run what it touched, run the private-name scan over every changed file, then push once
  (clause 20).

## 7. Deviations found

By slug; the coordinator mints the numbers (cross-plan ruling X9).

- **`next-step-from-measured-pr-facts`**: Table 1, the decider's inputs and rows; several pull requests offer none, and
  a sibling run whose PR state is not measured, or the queue word `absent`, offers none (HQ1, fix round 1, F5).
- **`land-it-needs-a-measured-accept`** (ruled, F2): "Land it" only when the run reads `merging`, or reads
  `awaiting-review` after its latest review run closed `done` with no send-back since; the tap's text names the request,
  the run and its PR (HQ1, HQ4).
- **`address-comments-waits-for-a-reader`**: the PR reader measures no review comments and W2 leaves `ccd/ccd` alone, so
  the control is never offered in W2 (HQ2).
- **`no-next-step-is-operator-only-in-w2`** (HQ3).
- **`next-step-tap-text-is-the-servers`**: the tap carries a step word and its run, and the server composes the text
  (HQ4).
- **`next-step-tap-goes-to-the-owner-at-the-tap`**: the tap goes to the owner's coordinator as resolved at the tap, and
  is refused only when nothing can be addressed, a set decided by the L1 `tapTargetOf` (HQ5, F16).
- **`next-step-news-is-a-fixed-line`** (HQ6).
- **`next-step-tap-shares-the-prompt-route-tail`** (F1): the prompt route's tail (known id, `renewing`, the draft rule,
  the send and W1a's mark) moves to `promptSession` in a move commit, and both paths call it (HQ7).
- **`land-it-asks-for-the-landing-gate`** (ruled, F2): one line in the coordinator skill's landing reference (HQ19).
- **`request-quote-on-the-home`** (ruled, F15): the quote is home requests B's, an on-demand read through
  `attestedQuoteOf`, never stored outside the expanded row (HQ20).
- **`request-spend-reads-run-spend`**: one summation for programmes and requests, moved out of `portfolioFor` if it was
  inline (HQ8).
- **`overlord-spend-is-the-live-reading`**: the Overlord's own spend is its bound session's live reading for the current
  generation, on the readiness read; no plan produced it (HQ9).
- **`requests-read-carries-spend-and-next-step`**: two optional fields on the doors piece's read (HQ10).
- **`chat-shows-ids-from-requests-and-names-from-the-chat`**: the names come from the chat read, through the relay's
  matcher; ids leave with their requests after seven days (HQ11).
- **`since-request-lines-from-row-times`**: W2's "since" counts openings, endings and news, not every move (HQ12).
- **`request-controls-from-the-transition-table`**, **`request-tap-shows-raced-outcomes`** and
  **`request-row-lists-its-acts`** (HQ13 to HQ15; acts on an unowned request are not shown in W2).
- **`goal-conflict-ruled-from-the-strip`** and **`requests-part-under-route-v1`** (HQ16, HQ17).
- **`goals-opened-is-not-home-requests`**: request ids A's RI10 is not built here (HQ18).

## 8. What the index should change

- **Table W2, the row "Home: requests and next steps":**
  - A: "`shared/nextSteps.ts`'s three fixed texts and prompt line, naming the request, the run and its PR;
    `nextStepFor` (L1, Table 1 of the plan, over the linked runs' `PrState`, queue word and review facts: any unmeasured
    sibling PR or an `absent` queue offers nothing, and 'Land it' reads review state, offered only when the run reads
    `merging` or reads `awaiting-review` after its latest review run closed `done` with no send-back; 'Address the
    comments' never offered in W2) and `tapTargetOf`, the tap's refusal set; `spendOfRuns`, one summation with
    `portfolioFor`'s, and `overlordSpendOf`; the request facts reader; the prompt route's tail moved into one function,
    `promptSession` (known id on the target, `renewing`, the draft rule, `sendPrompt`, W1a's mark), a move commit with
    its characterization, called by both the typed path and the `nextStep` branch (`nextStepTap.ts`), which sends the
    server's fixed text to the owner's coordinator as resolved at the tap and stamps a fixed news line, with no
    `operator_messages` row; one line in the coordinator skill's landing reference; the Overlord's own spend on the
    readiness read".
  - B: "the requests read's `spend` and `nextStep` and the chat read's `matched` (one server task); the Requests part in
    Table 4b's groups; the operator's request doors' controls from `REQUEST_TRANSITIONS`, each sending the revision it
    read and showing raced outcomes; Seen on a request's acts; goal conflicts on the strip and the rows they block, with
    the ruling sheet from `GOAL_CONFLICT_CHOICES`; the strip's health word and 85% date; the readiness spend; request ids
    and matched names under each operator message; request counts in 'since you were last here'; a request's quote, read
    from the private store on demand through request ids B's `attestedQuoteOf` under the request record's hash rule
    (`GET /api/requests/:id/quote`, read door `home-quote`)".
  - "Needs first", A: "request ids A, home B, forecasts B, W1a hand-offs" (forecasts B's amendment, `FCB --> HRA`; the
    hand-offs because the move carries their `renewing` check and mark). B adds "request ids B" (the quote).
  - Size: 2 PRs, 10 tasks (A 3, B 7). B gains the quote's task (ruled, F15).
- **The coordinator skill** (ruled, F2): `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` gains, in home
  requests A: "An operator's 'Land it (request N, run R, PR #P)' prompt asks for the normal landing gate for that run:
  re-measure the wave-done, rule on the review report, and enqueue by the repository's route. It never bypasses review
  or the verdict." `SKILL.md`'s twenty pinned clauses are unchanged.
- **Question 22, as amended by forecasts B:** add "A request's spend uses the same summation as a programme's
  (`spendOfRuns`). The Overlord's own spend is its bound session's live reading, current generation only."
- **"Where lanes meet":**
  - `server/src/server.ts` (F1): home requests A moves the prompt route's tail, which W1a's renewal hand-offs (#2934)
    write into (the `renewing` check and `markOperatorPrompt`), into `server/src/promptSession.ts`. A lands after the
    hand-offs, or its move commit re-measures and carries whatever of theirs has landed. The net estimate for
    `server.ts` is negative (about -3).
  - `server/src/coord/requestRoutes.ts` and `shared/overlordRequests.ts`: home requests B adds `spend` and `nextStep` to
    the requests read's rows, and the quote read, after the operator's request doors.
  - `server/src/coord/overlordChat.ts`, `shared/overlordChat.ts` and the chat's read: home requests B adds `matched`
    through the relay's `citedNamesOf`, after relay A.
  - The readiness read (`server/src/coord/overlordRoutes.ts`): home requests A adds `spend` beside `ReadinessWire`.
  - The portfolio module: home requests A moves forecasts B's spend summation to `server/src/coord/spend.ts` if it is
    inline, a move commit with its characterization.
  - `shared/refusal.ts`: home requests A adds `no-owner` and `no-coordinator` to the prompt route's group.
- **Figure W2:** the edges `RLA --> HRB` (the matcher) and `RIB --> HRB` (the quote).
- **The W3 since-block piece:** it records the operator's opening of a request-backed goals version (request ids A's
  RI10), and composes the "changed that matters" lines a server row must carry (a weakened done test, a goals version
  on a relayed request, every request move).

## 9. Where things stand

**Agreed:**
- From the brief and the index: lane F; A is server-side next steps, the tap and spend; B is the console; question 17
  (goal conflicts on the home), question 22 as amended (`run_spend`, `FCB --> HRA`), H18 (no tap refused for a stale
  revision), F15 (ids and names under each message, from the requests read).
- From fix round 1 (review 2298): "Land it" needs a measured accept, and its text names the run and its PR (F2); the
  quote is this plan's (F15); one tail for both prompt paths (F1); unmeasured siblings and `absent` offer nothing
  (F5); the refusal set in L1 (F16).
- From the producing plans: the doors' bodies and answers, hand back's step-up, the `requests` topic; the act read and
  Seen; `GOAL_CONFLICT_CHOICES` and the ruling door's body, dark and with no step-up; `blockedBy` on the read;
  `citedNamesOf`.

**Waiting on the coordinator:** nothing new. HQ1 to HQ20 stand as the plan builds them, with fix round 1's rulings
folded in. The ones that change what the operator sees are HQ1 ("Land it" waits for a measured accept), HQ2 ("Address
the comments" not offered in W2), HQ5 (a tap goes to the owner as it stands), HQ9 (the Overlord's spend is the current
generation's), HQ12 (the "since" counts) and HQ20 (the quote on the expanded row).

**Waiting on the operator:** nothing. Item 357 answered the goal-conflict choices, and the sheet renders the table.

**Later:**
- A piece that adds review state to `ccd pr-state`'s line fills `nextStepFor`'s `comments` input.
- The Log page lists every act, unowned requests' included.
- W3's server composition of "since you were last here".
