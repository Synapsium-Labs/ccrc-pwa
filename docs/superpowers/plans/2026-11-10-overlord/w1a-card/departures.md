# Card PR B: departures from the plan, and what Task 3 measured

Plan: `docs/superpowers/plans/2026-11-10-overlord/w1a-card.md`, Tasks 3 to 5 (PR B). Each departure is named by a slug; no
deviation number was taken. The coordinator folds these into the ledger.

## What Task 3 Step 1 measured (the reads)

| Fact | Read | New SQL? |
|---|---|---|
| Runs by claimant (and a worker's bound run) | the binding's own readers (ARCH-62): `openRunsClaimedBy` and `openRunsForSession`, each run hydrated by `run(id)`; `bindingRunsOf` for the newest run of a session between runs; `openCoordinatorIds` for the role | no |
| A child's run kind | `CoordStore.run(id)` | no |
| Claims by holder | `CoordStore.activeClaims()`, filtered by `heldBy` | no |
| Declared coordinator intent | `CoordStore.coordinatorIntentDeclared(sessionId, incarnation)` over `delegation_sessions`, keyed on `$REG/<id>.generation` (`childReclaimGenerationRead`) | **yes, the one new read** |
| Items by raiser, and each programme's open items | `CoordStore.itemsFor(null, now).open`, read once and filtered | no |
| The ledger by programme slug | `CoordStore.goalsFor(slug)` (the pin, its `doneWhen` and the modifications) | no |
| Outstanding deliveries to a session | `CoordStore.outstandingMailFor(id, 100)` | no |
| The registry's child mark | `readSessionRecord` (`found` → its `child`, `absent` → none, anything else → unmeasured) | no |

## Departures

- **card-read-by-the-start.** The plan's lane reads `cardReadsSince(cursor)`. This piece reads, for each generation whose
  effective state is `carded`, the newest full read by the conversation its start reported (`cardReadOfStart(startId)`,
  matched on the start's `sessionId` and `uuid`). A session can read its card before the lane's next pass mints its
  generation; a cursor would pass over that read, and a match by conversation never does. So `continuity_card_reads`
  carries the reader's `uuid` (the door's attributed `byUuid`), a column the plan's schema did not name.
- **card-current-hash-is-the-last-served.** "A read of an older hash does not move it" needs the session's current hash.
  `continuity_snapshots` gains `hash` (the card hash the snapshot rendered to when last served) and `served` (a sequence
  over every serve); the current card is the session's snapshot with the highest `served`. One row per snapshot id still
  holds: a later serve of the same facts updates those two columns, never inserts.
- **card-read-is-the-last-page** (as the plan says), built as a bounded memo of the pages of one hash served to one
  conversation (`routes.ts`). The read is recorded when every page of that hash was served, in any order; a new hash starts
  over. The memo is the door's bookkeeping: a restart forgets a card half read, and the caller reads it again.
- **card-intent-reads-the-projection.** Declared intent lives in the delegation lane's checkpoint and its SQLite
  projection, keyed by (session, registry incarnation). The card reads the projection on the current incarnation. A row
  with no `.generation` file reads as no intent (the intent door refuses to declare without one); an unreadable one is
  unmeasured.
- **run-plan-path-not-stored.** No row stores a run's plan path (`runs` and `programs` have none). `CardRun.planPath` is
  always null and the run line prints `plan=none`. A later piece that stores the path fills it.
- **goals-unratified.** No goals version carries `ratifiedBy` yet, so every goal is rendered as not ratified, inside the
  untrusted block. A programme's goals are its In short line and its `doneWhen` entries; its decisions are its
  modifications, each with its ruling when one is recorded.
- **card-programmes.** A session's programmes are those of its open runs (claimed or bound) and of the open items it
  raised, and, for a session that claims no open run, the programme of the newest run in its binding series, claimed or
  worked (C51: a coordinator between runs gets its programme's card). The series is read by `bindingRunsOf`; telling a
  claimed run from a worked one there would be a run/session decision by hand, which ARCH-62's census forbids.
- **card-items-are-the-visible-ones.** Items come from `itemsFor`, so an item still inside its hold is not on the card
  (the console does not show it either). An item's text on the card is its title.
- **undecided-renders-the-wider-card.** An undecided role is drawn by the wider of the two cards it cannot tell apart:
  `coordinator` for coordinator-or-plain, `worker` for worker-or-reviewer (the reviewer's card is the same). Its reason
  names the fact that could not be read. `cardRoleOf` (L1, `card.ts`) decides it and joins `MUTANT_SETS`.
- **gather-returns-the-renderer.** `gatherCardFacts` answers `{ facts, renderer }` rather than `CardFacts` alone, so an
  undecided role's renderer is not re-derived from the facts.
- **card-attribution-by-byUuid.** The door's sender check is a second dep, `attributeReader`, over `attributionVerdict`
  with the `byUuid` field, beside the start report's `attribute` (`fromUuid`).
- **card-snapshots-kept.** Snapshots and card reads have no retention in this piece; each distinct set of facts a session
  is served adds one snapshot row. A retention sweep is a candidate follow-up.
- **card-page-chars (measurement not taken).** The plan asks for the build's tool-result cut size. It was not measured
  here. The HTTP pages are 12,000 characters, but `ccrc-api card` prints the whole card in one tool result, up to the
  15k-token budget (about 48 KB). If Claude Code cuts a Bash result below that, a card near its budget is cut when
  printed. This needs a measurement and possibly a smaller budget or a paged print; it is not decided here.
- **no-claude-md-edit.** The plan lists `CLAUDE.md`'s box-token paragraph in the door census. That paragraph names no
  continuity lane (the start report made no edit there either), and `box-token-census.test.ts` passes without one, so it
  is unchanged.
- **lane-step-in-the-mint-pass.** A read that landed before the generation was minted moves it in the same pass that
  mints it, because the card-read step runs after the mints.
