# Card PR B: departures from the plan, and what Task 3 measured

Plan: `docs/superpowers/plans/2026-11-10-overlord/w1a-card.md`, Tasks 3 to 5 (PR B). Each departure is named by a slug; no
deviation number was taken. The coordinator folds these into the ledger.

## What Task 3 Step 1 measured (the reads)

| Fact | Read | New SQL? |
|---|---|---|
| Runs by claimant (and a worker's bound run) | the binding's own readers (ARCH-62, ARCH-42): `bindingsOf(id)`'s `claimant()` and `worker()`, each run hydrated by `run(id)`; `bindingRunsOf` for the newest run of a session between runs; `openCoordinatorIds` for the role | no |
| A child's run kind | `CoordStore.run(id)` | no |
| Claims by holder | `CoordStore.activeClaims()`, filtered by `heldBy` | no |
| Declared coordinator intent | the delegation checkpoint's `coordinatorIntentByParent` (`FleetWatcher.delegationCheckpointIfReady`, keyed by `delegationIntentKey` on `$REG/<id>.generation`, `childReclaimGenerationRead`); `unmeasured` while the checkpoint is not ready (fix round 1, F4) | no |
| Items by raiser, each programme's open items, and the held items of the runs it claims | `CoordStore.itemsFor(null, <every hold>).open`, read once and split by `operatorWasShown` at the time of rendering | no |
| The ledger by programme slug | `CoordStore.goalsFor(slug)` (the pin, its `doneWhen` and the modifications) | no |
| Outstanding deliveries to a session | `CoordStore.outstandingMailFor(id, 101)`: 100 listed, and the 101st says more exist | no |
| The registry's child mark | `readSessionRecord` (`found` → its `child`, `absent` → none, anything else → the registry could not say) | no |

## Departures

- **card-read-by-the-start.** The plan's lane reads `cardReadsSince(cursor)`. This piece reads, for each generation whose
  effective state is `carded`, the newest full read by the conversation its start reported (`cardReadOfStart(startId)`,
  matched on the start's `sessionId` and `uuid`). A session can read its card before the lane's next pass mints its
  generation; a cursor would pass over that read, and a match by conversation never does. So `continuity_card_reads`
  carries the reader's `uuid` (the door's attributed `byUuid`), a column the plan's schema did not name. Fix round 1 (review
  2023 F3) bounds the match to reads made at or after the start's `receivedAt` (both the server's wall clock): a resumed
  conversation keeps its uuid, and a read from its previous generation no longer counts for the new one. **The `/clear`
  window (F6):** the door attributes `byUuid` against the registry's `.uuid` file, which takes a new conversation's uuid
  only at the supervisor's next tick, so a card read made as the first call after `/clear`, inside that window, is
  refused `stale-uuid` or recorded under the old uuid and never pairs with the new start. It fails closed: the carded
  stage's re-nudge asks for a second read, which carries the new uuid, and an unread card degrades at the stage's
  deadline. Never a wrong read.
- **card-current-hash-is-the-last-served.** "A read of an older hash does not move it" needs the session's current hash.
  `continuity_snapshots` gains `hash` (the card hash the snapshot rendered to when last served) and `served` (a sequence
  over every serve); the current card is the session's snapshot with the highest `served`. One row per snapshot id still
  holds: a later serve of the same facts updates those two columns, never inserts.
- **card-read-is-the-last-page** (as the plan says), built as a bounded memo of the pages of one hash served to one
  conversation (`routes.ts`). The read is recorded when every page of that hash was served, in any order; a new hash starts
  over. The memo is the door's bookkeeping, and a restart forgets a card half read, so every answer carries `recorded`
  (true when that answer recorded the full read), and `ccrc-api card`'s last line on the last page says whether it was:
  "the read is NOT recorded ... read it again from page 1" when it was not (fix round 1, F8). A read write that fails puts
  the memo back, so a retry of that page records it. **One read row per full read (F11c, ruled):** each request of a
  one-page card is a full read and adds a row; retention comes later.
- **card-intent-reads-the-checkpoint** (was card-intent-reads-the-projection; fix round 1, F4). Declared intent is read
  from the delegation lane's checkpoint, the authority (`coordinatorIntentByParent`, through
  `FleetWatcher.delegationCheckpointIfReady` and `intentOfCheckpoint`), on the current registry incarnation. The SQLite
  projection is written after the checkpoint and can lag it, so a declaration not yet projected read as a definite "no
  intent" there; the projection reader is gone. A checkpoint that is not ready is `unmeasured`, never "no intent". A row
  with no `.generation` file reads as no intent (the intent door refuses to declare without one); an unreadable one is
  unmeasured.
- **run-plan-path-not-stored.** No row stores a run's plan path (`runs` and `programs` have none). `CardRun.planPath` is
  always null and the run line prints `plan=(not recorded)` (fix round 1, F12: `none` would say the run has no plan). A later
  piece that stores the path fills it.
- **goals-unratified.** No goals version carries `ratifiedBy` yet, so every goal is rendered as not ratified, inside the
  untrusted block. A programme's goals are its In short line and its `doneWhen` entries; its decisions are its
  modifications, each with its ruling when one is recorded.
- **card-programmes.** A session's programmes are those of its open runs (claimed or bound) and of the open items it
  raised, and, for a session that claims no open run, the programme of the newest run in its binding series, claimed or
  worked (C51: a coordinator between runs gets its programme's card). The series is read by `bindingRunsOf`; telling a
  claimed run from a worked one there would be a run/session decision by hand, which ARCH-62's census forbids.
- **card-items-held-for-their-coordinator** (was card-items-are-the-visible-ones; fix round 1, F14, ruled). An item the
  operator is shown is on every card that reads its programme. An item still inside its coordinator-first hold (an
  end request, a review release) shows, marked "held for you", only on the card of the coordinator whose hold it is: the
  session that claims the item's run. It is on no other card, not even the card of the session that raised it. The
  gatherer reads every open item once, the hold disregarded, and splits them by `operatorWasShown`, the hold's one rule.
  An item's text on the card is its title.
- **undecided-renders-the-wider-card.** An undecided role is drawn by the wider of the two cards it cannot tell apart:
  `coordinator` for coordinator-or-plain, `worker` for worker-or-reviewer (the reviewer's card is the same). Its reason
  names the fact that could not be read. When the registry could not say whether the session is a child at all
  (`CARD_REGISTRY_UNREAD`, fix round 1, F7), it is kept apart from an unreadable child marker: no role is ruled out and the
  widest card, the coordinator's, draws it. `cardRoleOf` (L1, `card.ts`) decides it and joins `MUTANT_SETS`.
- **gather-returns-the-renderer.** `gatherCardFacts` answers `{ facts, renderer }` rather than `CardFacts` alone, so an
  undecided role's renderer is not re-derived from the facts.
- **card-attribution-by-byUuid.** The door's sender check is a second dep, `attributeReader`, over `attributionVerdict`
  with the `byUuid` field, beside the start report's `attribute` (`fromUuid`).
- **card-snapshots-kept.** Snapshots and card reads have no retention in this piece; each distinct set of facts a session
  is served adds one snapshot row. A retention sweep is a candidate follow-up, and it must delete in this order: a read
  names its snapshot (`continuity_card_reads.snapshotId REFERENCES continuity_snapshots(id)`, no `ON DELETE`,
  `foreign_keys` on), so a snapshot's reads go before the snapshot. Migration 69 carries
  `continuity_card_reads_by_snapshot`, so each such delete is a keyed one (fix round 1, F11b). The serve sequence
  (`served`) is each session's own, read through `continuity_snapshots_by_session` (F11a).
- **card-page-chars (measured, fix round 1, F1 as ruled).** Measured in this worker's own pane on Claude Code build
  2.1.325, on 2026-11-14: a Bash result of 29,900 ASCII characters arrived whole; one of 30,050 characters, and one of
  29,443 characters that was 30,243 bytes, were each replaced by a 2 KB preview and a file path. So this build stops
  showing a result whole at about **30,000 UTF-8 bytes**, and it counts bytes, not characters. Recorded as
  `TOOL_RESULT_CUT_BYTES` (`shared/continuity-card.ts`). `ccrc-api card` now prints ONE page per call (`--page N --hash
  H`, page 1 by default) with a last line naming the page, the page count, the hash and the exact command for the next
  page. `CARD_PAGE_CHARS` is 7,000 code points, so a page of four-byte characters (28,000 bytes) and its footer (under
  400 bytes) stay under the cut; `continuity-card-render.test.ts` pins that, and pins the cut at or under 30,000. The
  15,000-token budget is kept, so a full card of ASCII text is about seven pages. Re-measure on a new build. A follow-up
  could page by UTF-8 bytes rather than code points, which would make an ASCII card about two pages.
- **no-claude-md-edit.** The plan lists `CLAUDE.md`'s box-token paragraph in the door census. That paragraph names no
  continuity lane (the start report made no edit there either), and `box-token-census.test.ts` passes without one, so it
  is unchanged.
- **lane-step-in-the-mint-pass.** A read that landed before the generation was minted moves it in the same pass that
  mints it, because the card-read step runs after the mints. Only a read made since the start was received counts
  (card-read-by-the-start).
- **lane-applies-every-changed-step** (fix round 1, F5). `generationStep` (L1) now reports `changed`, a comparison of the
  whole view, and the lane's apply loop (`applyFedEvents`, apart from the feed) writes every changed step, state or not,
  and skips the rest. So the renewal act's ordered feed (nudges, the receipt, probe rounds) can hand its events to the same
  loop. Mutant G19 in the machine's set holds the whole-view comparison.
- **card-masked-whole** (fix round 1, F2). The card is masked once, whole, in the door, before it is hashed and paged, so a
  secret that crosses a page edge is masked as one string. The route moved from `MASKED_GET_ROUTES` to the `INLINE` entry
  of `secret-mask.test.ts`'s census, as `/api/mail/inbox` did. The card hash names the masked text, which is what the
  reader sees.
- **card-raw-row-is-the-pane** (fix round 1, F13). The raw row `sessions card <id>` takes only `page` and `hash`; the pane's
  `byId` and `byUuid` are filled from `derive_identity` after them, the rule D-8125 gave `runs review-rounds`. A typed
  `--byId` is `unknown-query`.
- **card-mail-capped** (fix round 1, F15). The card lists at most 100 outstanding deliveries, the newest, and says when
  more exist. A delivery the mailbox shows after the delivery lane stopped trying it is labelled "parked", not "not
  answered". The coordinator's runs heading reads "Runs you claim or work".
- **card-columns-on-a-shadow-walk** (fix round 1, F15, for the probes and fence piece). A card read in shadow writes
  `cardHash` and `snapshotId` on the generation row. Those columns came with migration 68, have no shadow pair, and are not
  cleared by `clearShadowWalk`. Nothing reads them today, so they are an added record, not a second writer of a fact; the
  probes and fence piece should know they may hold a shadow walk's values.
