# Overlord W1: the `overlord-v1` word Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one pull request makes W1 reachable. It adds the server capability word `overlord-v1`, and with it:

- **The word.** `shared/api.ts#SERVER_CAP_MAP` gains the row `overlord-v1`. `GET /health`'s `caps` then names it, and the
  fleet box's `~/.ccrc/server-caps` names it within a minute.
- **The Overlord's own doors pass step 2.** Seven door rows carry the word: `inbox`, `messages`, `acknowledge`,
  `history`, `link-team` and, once they land, `board` and `sequence`. Their gate's step 2 stops refusing
  `capability-missing`. Step 1 still refuses every caller but the designated session.
- **The client follows the word.** `ccrc-api`'s rows for those doors refuse `capability-missing` locally, unsent, when
  a current cap file omits the word. This uses the client's existing table of gated rows, not a new mechanism.
- **The Overlord's card.** The one placeholder line, `CARD_OVERLORD_LINE`, becomes the Overlord's W1 card. The card lists
  every unsettled operator message and is never trimmed below that list (I8's second half). It also lists the role's
  pending timers.
- **The console.** The console already hides every Overlord door until the word stands (home A). This piece only
  types the console's constant, `OVERLORD_CAP`, against the server's word list.
- **The skill's bullet.** `CLAUDE.md` gains the `ccrc-overlord` bullet, and `overlord-skill.test.ts` scans it for the
  count word.

**Why:** before this merge, the console hides every Overlord door, the Overlord's doors refuse `capability-missing`, the
card carries one placeholder line, and nobody can be designated from the console. After it, the operator can tap Start
the Overlord. The flip must be **complete**: every behaviour the plans hold for the word turns on, and nothing waits on
a hold this plan did not find. It must be **checkable**: each behaviour has a case that goes red if the flip misses it.
It must be **reversible**: the way back is written down, both with nobody designated and with a bound Overlord.

**Architecture by ring:**

| Ring | What this piece touches | Rule kept |
|---|---|---|
| L0 `shared/` | `api.ts`: one `ServerCap` member and one map row. `continuity-card.ts`: one OPTIONAL `CardFacts` field, `messages?`, and its row type `CardMessage` | One owner per word: the map's keys. No `node:*` import |
| L1 policy | `server/src/continuity/card.ts`: the Overlord's renderer, replacing the one line, its own nothing line, the messages section with its named cap, and the snapshot reader's rule for the new field. `pwa/src/overlord/homePlace.ts`: `OVERLORD_CAP` typed as `ServerCap` (a type-only import) | The renderer decides from facts. It reads no word and makes no I/O |
| L3 adapters | `server/src/continuity/cardFacts.ts`: the gatherer declares its own port, `CardMessagesPort` (`messageSessionOf` and `unsettledFacts`), and reads `unsettledFacts()` through it | The port is declared by the consumer. The notes' port, `NoteKeysMessages`, stays as narrow as it is. Nothing is narrowed: an unreadable store reads `unmeasured`, never "no messages" |
| L4 delivery | `server/src/continuity/routes.ts`: ONE type-only edit, the deps field `operatorModel` widened from `NoteKeysMessages` to `CardMessagesPort` (it already passes `deps.operatorModel` to the gatherer) | No decision in delivery code: the edit is a type, and no line of logic changes |
| L5 | None. `index.ts` and `server.ts` are not edited | |
| ccd (bash) | `ccd/ccrc-api`: the gated-rows table gains the Overlord's rows; its check no longer reads only `plan.*` | One table and one check (the table's own comment: "One table (row key, word, refusal text), one check that reads it") |
| Docs | `CLAUDE.md`: one bullet | Public repo: no private name |

**Tech Stack:** TypeScript (ESM), vitest, bash 5 (`ccd/ccrc-api`), React (no component change).

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`. The sections this piece reads:

- §3.3.3, C38: the card, what it holds, and I8 ("open holds and unsettled operator messages are never trimmed").
- §4, C8: "Without `overlord-v1` nothing of the Overlord is drawn".
- §7.5, "The ladder needs `overlord-v1`".
- §11.1, Table 11.1d: the capability words, `overlord-v1` among them.
- §11.2: the gate order, step 2.
- §11.4: clause 22 (built as coordinator clause 24, #3354), which acts only under the word.
- §11.5: "A capability word is a property of the build", and Table 11.5's older-build rows.
- §14, Table 14's W1 row: `overlord-v1`.
- Question 33 (the index): designate and rebind refuse without `continuity-v1`, and the console hides every Overlord door
  until this piece lands.

**The index:** `docs/superpowers/plans/2026-11-14-overlord-w1.md`, Table W1's row `overlord-v1`: "1 PR, 2 tasks", lane C,
last of all. It needs "every other W1 piece but the Overlord clause, and W1a's `continuity-v1` and anchor".

Written against `main` at `4fa87d73f87c3b475086bab3ad0e893fa8935238` (2026-11-25), and revised in edit round 1 after
plan review 3877, with the coordinator's rulings (call 1340) marked "(ruled)". Every "re-measure at build" row of Table 3
is a check that its piece has merged and its symbol exists on the `main` the builder starts from.

## Open questions

Every question is now ruled (call 1340): 1 to 6 and 9 to 11 as recommended, 7 and 8 as the coordinator stated, and 12
as recommended with entry row E11 widened. None of them changed what W1 is for, so none went to the operator.

1. **Is the word held at the server or only in the console?** (slug `overlord-v1-is-held-at-both-ends`.) The index's
   question 33 says "there is no separate server-side `overlord-v1` gate: the console hides every Overlord door". The
   board and history plan (its question 11), the gates, inbox and sequence plans, and `main` put the word at step 2 of
   the gate on the Overlord's own doors (`OverlordDoorRow.word`). **Recommendation:** both readings are right about
   different doors. Question 33 speaks of the operator's doors (designate, rebind and the rest), which carry no word.
   The Overlord's own doors refuse at step 2. This piece changes neither: it adds the word, and both holds lift
   together. The index's sentence gains that clause (Index changes). **(Ruled: as recommended.)**

2. **What does the card's list of unsettled messages carry: facts or text?** (slug `card-lists-message-facts-not-text`.)
   The private-store plan's question 15 hands this piece the list and names the reader `unsettledMessages()`, which
   carries the text. The inbox plan names `unsettledFacts()`, which carries none. **Recommendation:** facts only. Each
   line is the message's id, its time, its state and whether its text was cut. The Overlord reads the words through
   the `messages` door, which writes a read-ledger line for each read (§9.4). If the card carried the text, the
   operator's words would reach the session without that ledger line, and the card's 15k-token budget would rest on
   what the operator typed. A facts line is short, so the list nearly always fits whole. When it does not, the card
   lists the ids and says how many lines it left out (I8). **Alternative:** the text, masked and capped as the store
   holds it. That needs a read-ledger line per card read, written by the card door, which is a second ledger writer.
   **(Ruled: as recommended.)**

3. **What does the W1 card hold besides the list?** (slug `w1-card-renders-what-w1-has`.) §3.3.3 lists seven parts.
   **Recommendation:** the card renders the parts whose facts exist in W1, in the spec's order:
   1. the role line;
   2. the authority line, when a fenced block follows;
   3. the constitution pointer, which names the workspace memory file the launch profile ships;
   4. live state: the unsettled messages (never trimmed), the role's pending timers, and the notes;
   5. the checkpoint, at a renewal only;
   6. the history line.

   The live grants, open holds, open requests, live commands, recent acts, the operator-model entries and the practice
   notes come with the waves that build them (W2 to W4b). Each of those waves adds its section to this renderer, and the
   card prints no "none" line for a part that does not exist yet. **(Ruled: as recommended.)**

   **The never-empty rule (C51) for the Overlord** (ruled, F8; slug `overlord-nothing-line-names-its-facts`). The settled
   rule stands for the Overlord too: pending timers are not body facts (`timers-are-not-body-facts`, review 2064 F3), so
   a card holding only timers carries the nothing line and its timers section. The Overlord's `BODY_FACTS` row is
   `messages`, `notes` and `checkpoint`, never `timers`. `CARD_NOTHING_LINE` names runs, claims and coordinator intent,
   which the Overlord's renderer never reads, so the Overlord's card gets a nothing line of its own,
   `CARD_OVERLORD_NOTHING_LINE`: "No unsettled operator messages, notes or checkpoint were measured for this session."

4. **Does the card renderer read the word?** (slug `card-renderer-held-by-the-build`.) §7.5 says "the hook's card
   arm" acts only under the word. **Recommendation:** no. The renderer and the word ship in one build, so a server that
   renders the W1 card always advertises the word. A rollback takes both back together. This is the clause plan's ruling
   for clause 24 (`coord-clause-condition-held-by-the-build`). The hook has no Overlord card arm. It prints the anchor
   that the card door answers, so it needs no edit. That a hook arm exists is a spec fix. **(Ruled: as recommended.)**

5. **How does the client gate the Overlord's rows?** (slug `client-word-gate-is-one-table`.) `ccd/ccrc-api` already has
   a table of gated rows: the `case "$key"` that sets `gate` and `gate_msg`, read by one check. That check runs only
   for `plan.*`. The W2 route plan (its question RV9) expects "one row of that table per prefix". **Recommendation:**
   - The table gains a row for each Overlord row: `overlord.inbox`, `overlord.messages`, `overlord.acknowledge`,
     `overlord.history`, `linking.confirm`, and, when they land, `overlord.board` and the sequence row.
   - The check drops its `plan.*` condition, so it reads every row of the table.
   - The timers' gate and the older gates stay as they are, because this piece leaves those rows alone.
   - A census test holds the table to `OVERLORD_DOORS` strictly, in both directions: every Overlord row of word
     `overlord-v1` has a client row, a table row and a door tool; every table row of that word is such a row; and every
     door the door-process plan marks readable has its tool's reader flag set (ruled, F1; "The client" below).
   - **Alternative:** a `[[ "$key" == overlord.* ]]` prefix gate. That would miss `linking.confirm`, and it would miss
     the sequence row, whose key the sequence plan names bare `sequence`.

   **(Ruled: as recommended**, with the census strict in both directions (F1), and the client's cap-reader census
   updated in the same commit (F6, Task 2).)

6. **How is the console's constant typed?** **Recommendation:**
   `export const OVERLORD_CAP: ServerCap = 'overlord-v1'`, with `import type { ServerCap } from '../../../shared/api'`.
   - `homePlace.ts` keeps its "imports types only" rule, so the mutation sets still load it by path.
   - A revert of the map row makes this line a compile error. The console's constant then goes with the word.
   - **Alternative:** a value import of `SERVER_CAPS`. That breaks the types-only rule.

   **(Ruled: as recommended.)** The annotation is the hold: Task 2's `SERVER_CAPS` case is green once Task 1 adds the
   word, so it cannot be written red first, and the type error a revert raises is what keeps the two together.

7. **Does this piece wait for chat PR B (the replies)?** The chat plan says it need not (its question 7) and calls it
   the coordinator's call. The index says this piece waits for every other W1 piece. **(Ruled, F3: the merge waits for
   chat B, as the index says.)**
   - Operator item 327 ruled that each reply is recorded in the private store when its turn ends.
   - Replies are recorded only once chat B's writer (`recordReply`, `overlord_replies`) exists. An Overlord that
     converses before chat B leaves a gap in that record for good: the replies it gave before then are never recorded.
   - No plan builds a reader of the replies in the checkpoint. The chat plan says only that "the piece that assembles
     the Overlord's checkpoint reads it". That reader is a row with no owner, listed under "Later"; the coordinator adds
     a ticket for it.

8. **Three Overlord doors have no door-process tool** (ruled, F1). On `main`, `ccd/door-process.mjs#DOOR_TOOLS` has no
   `history`, `board` or `sequence` row, and every row is `reader: false`.
   - **`history`:** the door, its row and its `ccrc-api` row are merged; the tool is owed under ticket
     `history-door-process-row` (review 3730 F3, call 1063), which says it rides board B2.
   - **`board`:** board B2 adds the door and its client row `overlord.board`. Its tool rides board B2 too (the
     door-process plan's and the index's reading; the coordinator carries it into that brief). Without it the Overlord
     meets a missing tool at the board, the third step of the skill's start order ("card, then the probe round, then
     the board"). History is not in that order; it is reached when the Overlord needs it.
   - **`sequence`:** sequence C adds the door and its client row `sequence`. Its tool rides sequence C, the sequence's
     door pull request (the coordinator carries it into that brief).
   - The door-process plan (its question 9) marks `board` and `history` readable, `reader: true`. The history door's
     row is fenced and the read tool serves only unfenced views; that conflict is the ticket's, settled in board B2.
   - **This piece carries no door-process edit.** All three tools are entry conditions (Table 3, E1, E3, Figure 1), and
     Task 2's census holds them, strictly: every row of the word has a client row and a tool, and a door the
     door-process plan marks readable has its reader flag set, so E3 cannot go green on a tool nobody can read through.

9. **What does the console show after a revert while an Overlord is bound?** Reverting the word hides every Overlord
   door, including Retire, Pause and the ladder, while the designation and its body stand. The server's operator doors
   still answer, but the console offers none of them. **Recommendation:** keep home A's rule, and write the way back as
   a runbook. The operator retires the Overlord (or sets the rung to `off`) before the word is reverted. If a revert
   happens with a bound Overlord, the way back to Retire is to roll forward to a build with the word.
   **Alternative:** draw Retire and Pause whenever a designation reads bound, whatever the word says. That changes
   home A's `overlordShown` rule and its tests, and belongs in a home pull request of its own if the coordinator wants it.
   **(Ruled: as recommended.)**

10. **Does `DESIGNATE_SERVER_WORDS` gain `overlord-v1`?** **Recommendation:** no. The designation reads this server's
    own `SERVER_CAPS`, and the word ships in the same build, so the check could never refuse. Question 33 stands.
    **(Ruled: as recommended.)**

11. **Does `OverlordDoorRow.word` narrow to `ServerCap`?** **Recommendation:** no. W2 adds door rows that carry
    `overlord-route-v1` before W2's last piece adds that word, and the row's word is exactly what holds those doors.
    The census's `SERVER_WORDS` stays a hand list of W1's words. Task 1 adds a case that every W1 word on a row is in
    `SERVER_CAPS`. **(Ruled: as recommended.)**

12. **Does the merge wait for the W1a arming, or only the first Start?** The index's "What a merge arms" says the first
    designation waits for the `continuity` lane to be live (after the replay quiz baseline) and for the `launch-profile`
    lane to be live. **Recommendation:** the merge waits too, because the merge is what puts Start in front of the
    operator. A Start before the arming would place an Overlord that cannot renew. These are the coordinator's readings
    at landing (the entry checklist, rows E10 to E12), never a test. **Alternative:** merge, and let the operator's own
    Start wait. That depends on a console that knows nothing of the arming.
    **(Ruled: as recommended, with E11 widened, F2.)** The `anchor-slot` lane must be live too. While it is in shadow the
    anchor door answers `dark`, and the session hook prints today's role card, which tells the Overlord's body it is this
    project's coordinator and to load the coordinator skill: the opposite of the spec's R12.

## What exists today

Measured on `main` at `4fa87d73f8`, with `git grep` and by reading the named files.

- **The word list.** `shared/api.ts#SERVER_CAP_MAP` has fourteen words, ending `continuity-v1`. `overlord-v1` is not
  among them. `ServerCap` is the union of the same fourteen. `SERVER_CAPS` is derived from the map's keys and served on
  `GET /health` (`server/src/server.ts`). A `server` or `both` node writes it to `~/.ccrc/server-caps`
  (`server/src/update/serverCaps.ts`, from `watch.ts`), and a `fleet` node's `ccd-update-sync` copies it.
  `SERVER_CAPS_LEASE_S` is 180.
- **`continuity-v1` is built.** It is in the map, with the promise that the gate runs with the witness bound (door
  process B1). The index's prerequisites table and its "W1 also reads words it does not add" sentence still say "not
  started" and "not yet built", and so do two lines of the programme ledger. `main` rules; see Index changes.
- **The Overlord's own doors.** `server/src/coord/overlordDoors.ts#OVERLORD_DOORS` has five rows whose `word` is
  `overlord-v1`: `link-team` (`POST /api/linking/confirm`), `inbox`, `messages`, `acknowledge` (in
  `overlordInboxRoutes.ts`) and `history` (`overlordHistoryRoutes.ts`). The gate decider
  (`server/src/coord/overlordGate.ts#overlordGate`) checks step 1 (who calls) before step 2 (the word). So today the
  designated session gets `capability-missing` from these doors, and every other caller gets `not-the-overlord`.
- **The inbox wake.** It asks the gate for the `inbox` row only while an Overlord is designated, so today it would hold
  `capability-missing` (`overlord-inbox-wake.test.ts`, "a server without overlord-v1 holds capability-missing").
- **`link-team` stays refused after the flip.** Its act is allowed at the `full` rung only, and W1's rung door stops at
  `chat`. So after this merge the Overlord's team link refuses at step 10 (`rung-below`) instead of step 2.
- **The client.** `ccd/ccrc-api#ROUTES` has 102 rows, among them `overlord.inbox`, `overlord.messages`,
  `overlord.acknowledge`, `overlord.history` and `linking.confirm`. None of them has a word gate. The client calls
  `_api_server_cap` at seven sites, which `server/test/census-w3/claimant.ts#capReaderCalls` lists and
  `server/test/census-w3/claimant.test.ts` pins line by line: the review-rounds loop (`review-rounds-v1`, unguarded by
  design), the claimant rows' gate (`questions-v1`), the `goals.show` and `calls.record` checks, the `plan.*` check,
  the `case` table of `plan.phase-ref`, `plan.take`, `plan.triage` and `plan.ticket-done` (its check line is
  `if [[ "$key" == plan.* && -n "$gate" ]] && ! _api_server_cap "$gate" && _api_server_cap ''; then`), and the
  `timer.*` check. Every gate fails open on an absent, stale, torn or future file. The census counts a call as guarded
  only when the same line first tests the claimant, `goals.show`, `calls.record`, `plan.*` or `timer.*`.
- **The door process.** `ccd/door-process.mjs#DOOR_TOOLS` serves `card`, `probe`, `probe_answer`, the four note tools,
  the three timer tools, `inbox`, `messages`, `acknowledge`, `link_team` and `read`. It has no `history`, `board` or
  `sequence` tool (question 8). Every row is `reader: false`, so the `read` tool's `door` input has no `enum` at all,
  and the tool answers that no door is readable yet.
- **The card.** `server/src/continuity/card.ts#renderCard` answers one section for the `overlord` renderer:
  `keepLine('overlord', CARD_OVERLORD_LINE)`, whose text is "The Overlord's card ships with W1 (`overlord-v1`)."
  `server/test/continuity-card-render.test.ts` pins that text. `BODY_FACTS` and `bodyOf` exclude `overlord`.
  - `CardFacts` (`shared/continuity-card.ts`) has no message field.
  - `gatherCardFacts` already reads `timers` (`pendingTimersOf`) for every role, and the timers plan says the Overlord
    sees them "once `overlord-v1` renders its card".
  - `continuity/routes.ts` already passes `messages: deps.operatorModel` to the gatherer. Its own deps field is
    `operatorModel?: () => (NoteKeysMessages & Partial<ReadLedgerCount>) | null | undefined`, and the gatherer declares
    `messages?: () => NoteKeysMessages | null | undefined`, where `NoteKeysMessages` (`server/src/continuity/noteKeys.ts`)
    is `Pick<OperatorModelStore, 'messageSessionOf'>`. At runtime `server.ts` passes the whole store. (The `Pick` of
    `moveMessage`, `messageStateOf`, `unsettledFacts` and `messagesSince` in `server/src/deps.ts` is the watcher's port,
    not this one.) The one test fake of the routes' field, in `continuity-report-route.test.ts`, is cast to the whole
    store, so the widened type checks it; that test reads no Overlord card.
  - `CardFacts` is built in three places in `server/src`: the gatherer; `server/src/continuity/probeSchedule.ts#spotFactsOf`,
    the facts a spot probe round is drawn from, which are never rendered as a card; and
    `server/src/continuity/card.ts#snapshotFactsOf`, which reads a persisted snapshot's facts back field by field
    (`fact(name, ok)`; a fact it cannot read is `{ kind: 'unmeasured', what: "the snapshot's <name>" }`). The snapshot id
    is a sha256 of `snapshotFactsJson`, the facts less `at`, so a field present on every card would move every
    session's snapshot id at deploy, and the probe rounds keyed on it would be drawn again. The test and simulator
    fixtures that build the literal: `server/test/sim/cardMutants.ts`, `anchorSets.ts`, `checkpointSets.ts`,
    `generationDay.ts`, `probeDoorSets.ts`, `probeSets.ts`, and `continuity-generations-lane.test.ts`,
    `continuity-renewal-acts.test.ts` and `continuity-anchor.test.ts`.
  - The card's `Fact<T>` (`shared/continuity-card.ts`) has two arms: `{ kind: 'read', value }` and
    `{ kind: 'unmeasured', what }`. The private store's `StoreRead` carries `why`, so the gatherer maps `why` to `what`.
  - `timersSections` caps its block at a named constant, `TIMERS_CAP_BYTES`. `renderCard(role, f)` takes no budget; the
    budget enters only through `trimCard(sections, budgetTokens)`, which never drops a `keep: true` section.
  - `renderCard`, `trimCard` and `oneLine` are in `server/test/sim/mutation-floors.json`, each at floor 1. The mutant
    set behind `renderCard` (`server/test/sim/cardMutants.ts`) has no mutant over an Overlord arm.
- **The private store's readers.** `server/src/operatorModel/store.ts` has `unsettledMessages()` (rows with text, id
  order, never trimmed) and `unsettledFacts()` (`MessageFacts`: `id`, `at`, `term`, `state` or `unknown`, `cut`; no
  text, id order, never trimmed).
- **The console.** `pwa/src/overlord/homePlace.ts#OVERLORD_CAP` is the string `'overlord-v1'`, and `overlordShown` is
  true only for an answered caps read that names it. The store makes no Overlord read without it
  (`pwa/src/stores/overlord.ts`). The routes, bars, palette and chord follow it (home A, #3207). The browser tests
  already stand a server advertising the word.
- **The skill.** The skill is merged (twenty-two clauses). Its `references/starting.md` door table names `inbox`,
  `messages`, `acknowledge`, `board`, `history`, `sequence` and `link team` under `overlord-v1`, and says to stop on
  `capability-missing`. `server/test/overlord-skill.test.ts` scans `README.md` for the count word wherever it names
  `ccd/overlord-skill/SKILL.md`. Its comment says the `CLAUDE.md` bullet lands with this piece. `CLAUDE.md` has no
  `ccrc-overlord` bullet.
- **The coordinator clause.** Clause 24 of the coordinator skill (#3354) is the Overlord clause. Spec §11.4 says the
  clause acts only while the server advertises `overlord-v1`; the clause's own text does not say so, and its plan rules
  that the build holds that condition (`coord-clause-condition-held-by-the-build`).
- **The hook.** `ccd/session-hook.sh` reads `_hook_server_cap` for `hook-main-state-v1` and `dispatch-live-gate-v1`
  only. It reads neither `continuity-v1` nor `overlord-v1`.
- **The census.** `server/test/overlord-doors-census.test.ts#SERVER_WORDS` is `['continuity-v1', 'timers-v1',
  'overlord-v1']`. Every Overlord row's word must be one of them.
- **The ladder.** `chat` needs no word (`shared/overlord-ladder.ts#RUNG_MAP`), so the flip changes no rung.
- **Size.** `server/test/growth-caps/shared-api-ts.json` caps `shared/api.ts` at 5,140 code lines (D-8635). By the
  growth check's own stripper (`growthCheck.ts#codeLines`) it counts 5,139 at `4fa87d73f8` and at `76e49414fc`
  (plan review 3877).

**Where the plans and `main` disagree** (`main` rules):

- The index says `continuity-v1` is not built. It is (above).
- The index's capability table says that without the word "the card carries no Overlord line". The card carries the
  placeholder line `CARD_OVERLORD_LINE`.
- The index's question 33 says "no separate server-side gate". The Overlord's own doors have one at step 2 (question 1).
- The private-store plan names `unsettledMessages()` for the card, and the inbox plan names `unsettledFacts()`
  (question 2).
- The index lists the Overlord clause as "waits on item". It merged as clause 24 (#3354).
- The board and history plan's B1 note leaves the history door-process row owed, and neither board B2's task list nor
  sequence C's adds its door's tool. The index and the door-process plan say "board and history B" each add their row.
  Ruled (F1): the board's and history's tools ride board B2, and the sequence's tool rides sequence C (question 8).

## The inventory

### Table 1. Every behaviour held for the word

The columns: the behaviour; where it lives on `main`; how it is held today; what this piece changes; the case that goes
red if the flip misses it. "Not on main" rows come from the pieces in Table 3 and are re-measured at build.

| # | Behaviour | File and symbol | Held today by | This piece | Red case if missed |
|---|---|---|---|---|---|
| H1 | The server advertises the word | `shared/api.ts#SERVER_CAP_MAP`, `ServerCap` | absent | adds the row and the union member | Task 1: `SERVER_CAPS` contains `overlord-v1` |
| H2 | `GET /api/overlord/inbox` serves the bound session | `overlordInboxRoutes.ts`, row `inbox` | step 2 refuses `capability-missing` | the word is in `SERVER_CAPS` | Task 1: the gate with production `SERVER_CAPS` passes step 2 for each W1 word row |
| H3 | `GET /api/overlord/messages/:id` | same file, row `messages` | step 2 | same | same |
| H4 | `POST /api/overlord/messages/:id/acknowledge` | same file, row `acknowledge` | step 2 | same | same |
| H5 | `POST /api/overlord/history` | `overlordHistoryRoutes.ts`, row `history` | step 2 | same | same |
| H6 | `POST /api/linking/confirm` for the Overlord | `linking/routes.ts`, row `link-team` | step 2 (then step 10 at `chat`) | step 2 passes; step 10 still refuses below `full` | same; `linking-overlord-confirm.test.ts` keeps its rung case |
| H7 | The inbox wake sends | `overlordInboxWake.ts` through the `inbox` gate | the gate's `capability-missing` | passes | `overlord-inbox-wake.test.ts` (injected words); Task 1's step-2 case covers production |
| H8 | `GET /api/overlord/board` | board B2, row `board` (not on main) | step 2 | same | Task 1's case iterates every row, so B2's row is included |
| H9 | `GET /api/overlord/sequence` | sequence C, row `sequence` (not on main) | step 2 | same | same |
| H10 | The client sends the Overlord's rows | `ccd/ccrc-api`, the gated-rows table | no hold | the table gains the rows and the check covers them | Task 2: a current cap file without the word refuses each row, unsent; the census |
| H11 | The door process serves the Overlord's tools | `ccd/door-process.mjs#DOOR_TOOLS` | through H10 and the server | nothing; each tool runs its `ccrc-api` verb (the `history` and `board` tools ride board B2, the `sequence` tool rides sequence C) | Task 2: every row of the word has a client row and a door tool, and `board` and `history` are readable |
| H12 | The Overlord's card | `card.ts#renderCard`, `CARD_OVERLORD_LINE` | a constant the renderer returns | the W1 renderer | Task 1: the render cases; the old pin is removed |
| H13 | The card lists every unsettled message (I8's second half) | `CardFacts.messages?` (new), `gatherCardFacts` | no field | the field, its gather and its never-trimmed section, capped at `MESSAGES_CAP_BYTES` | Task 1: past a small cap, the section lists every id and the left-out count, and every id survives `trimCard` at a small budget |
| H14 | The card lists the role's pending timers | `CardFacts.timers`, `timersSections` | not rendered for `overlord` | rendered (timers are not body facts, so a card holding only timers also carries the Overlord's nothing line) | Task 1: the timers case and the timers-only case |
| H15 | The console draws the Overlord | `homePlace.ts#OVERLORD_CAP`, `overlordShown` | string compare to an unadvertised word | typed as `ServerCap`; the server now sends it | `pwa/test/overlord-home-place.test.ts` (`SERVER_CAPS` contains `OVERLORD_CAP`, new) |
| H16 | The doors, palette row, `/overlord` route and desk door | home A (merged) | `overlordShown` | nothing | home A's suites (already written against the word) |
| H17 | The place: Start, Open, Rebind, Restart, Pause, the ladder controls, the readiness lines | home B (not on main) | `overlordShown` | nothing | home B's suites |
| H18 | Settings › Overlord | home C (not on main) | `overlordShown` | nothing | home C's suites |
| H19 | The chat | chat A (not on main) | `overlordShown` | nothing | chat A's suites |
| H20 | The coordinator clause acts | coordinator skill clause 24 | the build | nothing | none: held by the build (clause plan, question 2) |
| H21 | The skill's door table is true | `ccd/overlord-skill/references/starting.md` | the build | nothing | none: text |
| H22 | The `CLAUDE.md` bullet and its count word | `CLAUDE.md`; `overlord-skill.test.ts` | absent | adds both | Task 2: the scan's `CLAUDE.md` half |
| H23 | The census lists the word | `overlord-doors-census.test.ts#SERVER_WORDS` | a hand list | Task 1 adds "every W1 word on a row is in `SERVER_CAPS`" | that case |

Counts: 23 rows. 18 are on `main` today, and 5 wait on pieces not on `main` (H8, H9, H17, H18 and H19). This piece
edits code for 7 rows (H1, H10, H12, H13, H14, H15 and H22). It adds tests for 9 more: one case covers H2 to H9, and
one covers H23. The other 7 need no change from this piece: H11 and H16 to H19 follow the word through code already
written, and H20 and H21 are held by the build.

### Table 2a. Findings: behaviours the plans promise under the word with no hold in the code

| # | The promise | Where promised | What `main` has | What this plan does |
|---|---|---|---|---|
| F1 | "The hook's card arm acts only while the server's capability file carries it" | spec §7.5, §11.5 | No hook arm reads `overlord-v1`; the hook prints what the card door answers | Nothing in the hook. The renderer is held by the build (question 4); spec fix |
| F2 | "`ccrc-api`'s Overlord verbs refuse `capability-missing`" | index, capability table; spec §11.5 | No client gate on any Overlord row | Task 2 builds it (question 5) |
| F3 | "Designate and rebind" wait for the word | index question 33, home and designation plans ("the console offers Start only under `overlord-v1`") | The console hides the door. The server's designate door does not read the word, so a signed-in operator could designate through the API before this merge | Nothing (question 10). The entry checklist reads that no designation stands before the merge (E14) |
| F4 | The Overlord reads history, the board and its sequence through its door process | skill `starting.md`; door-process plan | No `history`, `board` or `sequence` tool in `DOOR_TOOLS`, and no readable row | Entry conditions with owners (board B2, sequence C), held by Task 2's census (question 8) |
| F5 | "Nothing of the Overlord is drawn" includes the readiness line on Fleet health and Waiting on you | home plan, question 9 | Not built yet (home B) | Re-measured at build: home B's tests read `overlordShown` |

### Table 2b. Findings: holds in the code that no plan names

| # | The hold | Where | Why it matters | What this plan does |
|---|---|---|---|---|
| G1 | `link-team` carries `overlord-v1`, but its act needs `full`, which the W1 rung door refuses | `overlordDoors.ts`, `link-team`; `shared/overlord-ladder.ts` | The flip does not make the Overlord's team link work. It moves the refusal from step 2 to step 10 | Recorded. W3 (`overlord-answer-v1`) opens `full` |
| G2 | `overlord-doors-census.test.ts#SERVER_WORDS` already lists `overlord-v1` while no server advertises it | the census | The census passed while the word was missing, so it cannot catch a flip that misses the map | Task 1's case reads `SERVER_CAPS` itself |
| G3 | The inbox wake holds `capability-missing` while designated | `overlordInboxWake.ts` | A designation made through the API before this merge (F3) would sit with a held wake | Covered by E14 |

Counts: five findings of the first kind (F1 to F5), three of the second (G1 to G3).

## What is not on `main` yet

Each row is re-measured at build: the builder checks that the piece merged and that the symbol named exists at the
`main` they start from.

### Table 3. The pieces this one waits for

| Piece | Plan | Open PR at writing | What this piece needs from it, by that plan's symbols | Re-measure at build |
|---|---|---|---|---|
| Sequence B (the invariant monitor) | `w1-sequence-monitor.md`, Tasks 4 to 6 | #3394 (draft) | `server/src/coord/invariants.ts` with the W1 predicates (I2, I5's term arm, I7, I17), `overlord_invariant_findings`, the runner on its `LANE_SCHEDULE` row `invariants` (shadow until armed), the Shadow lanes card's `invariants` row, and the ladder's cause row `invariant-violation`. The entry checklist reads its findings (E9) | yes |
| Sequence C (the read doors) | `w1-sequence-monitor.md`, Task 7 | none | `GET /api/overlord/sequence` with its `OVERLORD_DOORS` row (word `overlord-v1`), the operator's `GET /api/overlord/invariants`, the `ccrc-api` row the plan names `sequence`, and the door-process tool `sequence` (ruled, F1: it rides sequence C; the coordinator carries it into that brief). Its rows join Task 2's table and census | yes |
| Readiness | `w1-readiness.md` | none | `shared/overlord-readiness.ts`'s words, the `overlordReadiness` lane, `readinessRead()` and `GET /api/overlord/readiness`. With nobody designated the lane writes `absent` and pushes nothing. The entry checklist reads the word (E8) | yes |
| Board and history B2 (the board) | `w1-board-history.md`, Task 6 | none | `GET /api/overlord/board` (row `board`, word `overlord-v1`), `composeBoard`, the `ccrc-api` row `overlord.board`, and the door-process tools `board` and `history`, each `reader: true` as the door-process plan's question 9 marks them (ruled, F1; the `history` tool is ticket `history-door-process-row`). Its rows join Task 2's table and census | yes |
| Home B (the place) | `w1-home.md`, Tasks 4 to 7 | none | `OverlordPlace` and `BodyPart` (Start, Open, Rebind, Restart), Pause, the ladder controls, the readiness lines on Fleet health and Waiting on you, `useOverlordSessionStream`, the `@overlord-place` mark. Start the Overlord lives here | yes |
| Home C (Settings) | `w1-home.md`, Tasks 8 and 9 | none | Settings › Overlord (`OverlordSection`): Retire, the model class, the account set, the backstop, retention, the account facts and the account-hold Clear | yes |
| Chat A | `w1-chat.md`, Tasks 1 to 4 | none | The chat part of the place, its thread and earlier-generation doors, and `offRecord` | yes |
| Chat B (the replies) | `w1-chat.md`, Task 5 | none | `recordReply` and `overlord_replies`, so every reply is recorded from the Overlord's first turn (question 7, ruled F3) | yes |
| Renewal readings G | `w1-renewal-readings.md`, Task 10 | none | `placeHiddenObservedMs` read from the `@overlord-place` mark. On `main`, `generationsLane.ts` still has `placeHiddenObservedMs: later('W1')` | yes |
| Renewal readings H | `w1-renewal-readings.md`, Task 11 | none | `overlord_account_holds` with its door and reader, `heldOutOfList`, and the hold in `accountOutsideSet` and `installBehind` | yes |

Every other W1 piece is merged: vocabulary, pool set A1 to B2, ccd arms A to C2, serviceability A and B, renewal
readings A to F, journal kernel, authority journal A0 to C, designation A to C, ladder, gates A and B, the Overlord's
timers (#3388), isolation word, other lanes, sequence A and B1 (#3395), sandbox A, A2 and B, door process A1 to B2,
private store A and B, inbox, board and history A and B1, portfolio A and B, push outbox A and B, responses A and B,
home A, the skill and the Overlord clause (#3354). W1a's `continuity-v1`, anchor and renewal hand-offs are merged.
Delegation marks are outside the gate (the index).

```mermaid
flowchart LR
  SB["sequence B<br/>monitor"] --> SC
  SB --> RD["readiness"]
  RD --> BB
  RD --> HB["home B"]
  HB --> HC["home C"]
  HB --> CA["chat A"]
  CA --> CB["chat B"]
  HB --> RG["readings G"]
  RD --> RH["readings H"]
  RH --> HC
  SC["sequence C<br/>read doors, sequence tool"] --> V1["overlord-v1"]
  BB["board B2<br/>board and history tools"] --> V1
  HC --> V1
  CB --> V1
  RG --> V1
  RH --> V1
  AR["W1a arming:<br/>baseline, continuity,<br/>launch-profile, anchor-slot"] -.-> V1
```
*Figure 1. What `overlord-v1` waits for. Solid arrows are pieces that must merge; the board's and history's door tools
ride board B2, and the sequence's tool rides sequence C. The dashed arrow is the operator's arming, which the
coordinator reads at landing.*

## The entry checklist

Each row says where to read it, and whether a test holds it or the coordinator reads it at landing.

### Table 4. What must read true before this pull request merges

| # | Check | Where to read it | Held by |
|---|---|---|---|
| E1 | Every piece of Table 3 is merged, the door tools `board` and `history` (board B2) and `sequence` (sequence C) among them | `gh pr view <n> --json state,mergeCommit` for each; `git grep` of each symbol on `origin/main` | the coordinator |
| E2 | Every Overlord door row that carries `overlord-v1` has a client row and a row in the gated table, and every table row of that word is such a door | Task 2's census | a test |
| E3 | Every such row has a door tool whose `verb` is its client row's key, and the `board` and `history` tools are `reader: true` | Task 2's census | a test |
| E4 | Every W1 word on a door row is in `SERVER_CAPS` | Task 1's case | a test |
| E5 | `shared/api.ts` stays within its cap | the growth check (`growth-caps.test.ts`) | a test |
| E6 | Past `MESSAGES_CAP_BYTES` the messages section lists every id and the left-out count, and every id survives `trimCard` at a small budget | Task 1's case | a test |
| E7 | The count word is right in `CLAUDE.md` | `overlord-skill.test.ts` | a test |
| E8 | The readiness word reads `absent` with nobody designated, and its lane is fresh | `GET /api/overlord/readiness` | the coordinator |
| E9 | The invariant monitor's findings: none open but I7's. I7 is the predicate known to read "differs" by design: by ruling (call 1286, after review 3843), it compares the term and the model class with the journal's for equality, not only the authority fields for width, so it can read "differs" where the spec's older row said only "not wider" (the spec's row is amended on #3403). Before the `invariants` row is set Live, the coordinator reads I7 in the shadow record and explains every "differs". I5 reads measured once its baseline read is wired (#3394) | the operator's invariants read (`GET /api/overlord/invariants`, sequence C) or the Shadow lanes card's `invariants` row | the coordinator |
| E10 | The replay quiz baseline is recorded | the Shadow lanes card's quiz state (`LANE_ARM_QUIZ_STATES`: `recorded`) | the coordinator |
| E11 | The `continuity`, `launch-profile` and `anchor-slot` lanes are `live`. With `anchor-slot` in shadow the anchor door answers `dark` and the hook prints today's role card, which tells the Overlord's body it is a coordinator | `GET /api/coord/lane-arm` | the coordinator |
| E12 | Doctor's `overlord-mods` check passes on the fleet box | `ccrc doctor` | the coordinator |
| E13 | Every placing fleet node advertises the eight words of `DESIGNATE_CCD_WORDS`: `pool-set`, `keep-awake-v1`, `hibernate-fresh`, `launch-surface-v1`, `project-add`, `ws-title-v1`, `ws-wrapper-v1` and `fresh-pick-v1`; and the build inventory reads `agreed` (`inventoryBuildAgreement`), without which the designate door refuses `launch-profile-unmet` | `GET /api/updates`, the node inventory's caps and its builds | the coordinator |
| E14 | No designation stands (`GET /api/overlord/designation` reads none), and no Overlord timer, item or message row is pending | the designation read; the operator's timers read | the coordinator |
| E15 | The ladder has no standing latch from the shadow pieces | `GET /api/overlord/ladder` | the coordinator |
| E16 | `main`'s daily full suite is green at the merge base | the daily run's `full-suite` job | the coordinator |
| E17 | Sign-in is armed (the designate door refuses `auth-off` while it is dark) | `GET /api/auth/status` | the coordinator |
| E18 | The fleet box's agent advertises the agent word `overlord-history` (without it the history door answers `history-unreachable`) | `GET /api/updates`, the fleet node's `agentOps` | the coordinator |
| E19 | The fleet box runs a build that carries every Table 3 merge (the door process, the launch profile and the staged skill live there; E13 reads only ccd words) | `GET /api/updates`, the fleet node's measured stamp, against each merge with `git merge-base --is-ancestor` | the coordinator |
| E20 | Doctor's `skills` check passes on the fleet box, which measures the staged Overlord skill at `~/.cc-sessions/overlord-skill` | `ccrc doctor` | the coordinator |

Tests hold E2 to E7. The coordinator reads E1 and E8 to E20 at landing.

## What the merge arms

### With nobody designated

Measured against the code on `main` and the plans of Table 3:

- **The server.** `GET /health`'s `caps` gains `overlord-v1`. A `server` or `both` node writes it into
  `~/.ccrc/server-caps` on its next minute, and a `fleet` node's `ccd-update-sync` copies it on its next minute.
  No lane starts, no table is written, and no door answers differently: step 1 of the gate still refuses every caller
  `not-the-overlord`, because nothing is bound. No session's card changes, because no session's role reads `overlord`.
- **The client.** The gated rows stop refusing locally, so a session that calls them gets the server's own
  `not-the-overlord`.
- **The console.** Neither the desk nor the phone bar draws an Overlord door with nobody designated: `OVERLORD_DOOR`
  maps `none` and `unmeasured` to false, and `placesFor` draws the door only when it is true. Two things open: the
  palette's "Go to Overlord" (`g o`), and `/overlord`, which opens the place instead of replacing itself with `/fleet`.
  The place shows Start (home B), and Settings gains the Overlord section (home C). `/` still lands on the Fleet,
  because `homePlace` answers the Fleet with no designation. Once the word stands, every visible console reads the
  designation and the ladder every 60 seconds (`OVERLORD_POLL_MS`). The console re-reads the caps only at start and when
  the page returns to the front, so an open console picks the word up on a reload or a return.
- **Coordinators.** Clause 24 now acts, but with no Overlord it sends and asks nothing. The doors it names, `request
  ack` and the act read, do not exist on `main` as server doors or client rows (W2 builds them); a call answers the
  client's `unknown-verb` today.

### The operator's first tap

Start the Overlord (home B), behind the account gate's step-up:

1. The designate door checks the two-account count, ccd's eight words, `continuity-v1` and the build inventory (its
   step 3 refuses `launch-profile-unmet` unless `inventoryBuildAgreement` reads `agreed`), writes a `pending`
   designation, composes the session create in the `overlord` project with its profile and digest, and writes the
   route record.
2. `ccd keep-awake` writes the body's two sleep markers. The first prompt is delivered. Sandbox B's settle step moves
   the designation to `live` (or to `overlord-sandbox-unmet`).
3. The body reads its card: the W1 card of this piece, with its unsettled messages and timers. It then runs the probe
   round and reads the board, as the skill's start order says.
4. From then on: the readiness lane writes words for the bound session, the inbox wake sends, the timers lane serves
   the role, the renewal lane renews the body, and the monitor stamps and checks its lines.

### The way back

- **Retire, then revert (the runbook).** The operator taps Retire in Settings › Overlord. The retire door stops the
  body through the owed-stop drain, `ccd keep-awake --state off` removes the markers, and the route record's set is
  cleared. On their next passes the timer lane cancels the role's timers `retired` and readiness settles its items
  `retired`. A revert of this pull request's merge commit (the word's row cannot go alone: the console's typed constant
  makes that a type error) then leaves only inert history: the retired designation row, the private store's
  messages, the journals' lines, the sequence lines, and the readiness and response rows. Nothing reads them as live.
- **A revert with a bound Overlord** (question 9). The body keeps running: its sleep markers stand, so it is never
  hibernated or rolled, and the renewal lane keeps renewing it. Its card, note, probe and timer doors still answer
  (`continuity-v1`, `timers-v1`). The board, inbox, messages, acknowledge, history, sequence and team-link doors refuse
  `capability-missing` at step 2, and the client refuses them first. The inbox wake holds. The console hides every
  Overlord door, Retire and Pause among them, though the operator doors still answer at the server. The operator's
  prompts are still recorded as messages and stay unsettled. The remedy is to roll forward and Retire.
- **A rollback to an older server build** (`ccrc rollback`). This is everything in the case above, plus Table 11.5's
  rows. A build older than the designation ignores the Overlord's tables. An older timer lane cancels the role's
  timers `setter-gone`, and the cancel is final (the timers plan, question 7). An older mail lane's handling of queued
  `overlord` mail is the timers plan's measurement (F12). On the fleet box the markers stand. An older ccd refuses the
  Overlord's renewal on `.no-roll` (`opted-out`), which fails closed, and the capability floor's rows refuse a move
  below `pool-set`, `keep-awake-v1` or `launch-surface-v1` without `--below-cap`.

### Older builds side by side (additive wire, absence permits)

| Newer side | Older side | What happens |
|---|---|---|
| Server with the word | Fleet box `ccrc-api` without the table gate | The client sends, and the server answers. Nothing breaks |
| Fleet box `ccrc-api` with the gate | Server without the word | A current cap file refuses the rows locally, `capability-missing`, unsent. An absent, stale or torn file sends, and the older server answers its own step-2 refusal, or a 404 where the route does not exist |
| Server with the word | Console from home A on | The console compares the string and draws the doors: the same behaviour |
| Server with the word | Console older than home A | The console draws nothing of the Overlord |
| Console with the typed constant | Server without the word | `caps` lacks it, so the console hides everything |
| Server with the W1 card | Any hook | The hook prints the anchor the card door answers. The card is rendered on the server only |

No wire field is added or removed: `caps` is an existing array that gains one string, and every reader already treats an
unknown word as absent. One PERSISTED shape changes (ruled, F5): the card's snapshot facts gain the optional `messages`,
present on the Overlord's snapshots only. Every other session's snapshot JSON, and so its snapshot id, is byte for byte
what it is today. An older build reading a newer Overlord snapshot skips the unknown field; a newer build reading an
older Overlord snapshot reads `messages` as `unmeasured` ("the snapshot's messages"), never "no messages".

## The client

**The verbs that follow the word.** These are the `ccrc-api` rows whose server door is an Overlord door carrying
`overlord-v1`:

| Row | Door row | On `main` |
|---|---|---|
| `overlord.inbox` | `inbox` | yes |
| `overlord.messages` | `messages` | yes |
| `overlord.acknowledge` | `acknowledge` | yes |
| `overlord.history` | `history` | yes |
| `linking.confirm` | `link-team` | yes |
| `overlord.board` | `board` | board B2 |
| `sequence` (the key the sequence plan names) | `sequence` | sequence C |

`sessions.card`, the note, probe and handover rows, and the `timer.*` rows are not on the list: their doors carry
`continuity-v1` or `timers-v1`, and they serve every session.

**How each refuses below the word.** Each row gets the same rule as the existing gated rows. A current, well-formed
`~/.ccrc/server-caps` that omits `overlord-v1` refuses `capability-missing`, exit 2, unsent, with the detail "the server
this box talks to does not answer the Overlord's doors yet (it does not advertise overlord-v1); nothing was sent". An
absent, stale, torn or future file sends, as every gate in the client does.

**The closed table and its census.** The row count does not change (102 on `main`, plus the board and sequence rows when
they land), so `ccrc-api.test.ts`'s count words do not move for this piece. The gated table is one `case` block. Any
comment line Task 2 adds above it must not start with `# <word> rows`: `ccrc-api.test.ts` holds that phrase unique as
the `ROUTES` table's header anchor. The new census test (Task 2) reads the block and `ROUTES` from `ccd/ccrc-api`'s text,
and `OVERLORD_DOORS` and `DOOR_TOOLS` from their modules, and checks strictly, with no exception list (ruled, F1):

- every Overlord row (`group: 'overlord'`) of word `overlord-v1` has a `ROUTES` row whose method and path (`{id}` read as
  `:id`) are that door's;
- every such row is in the block with word `overlord-v1`, and every row of the block with that word is such a row;
- every such row has a `DOOR_TOOLS` row whose `verb` is the client row's key;
- every door the door-process plan marks readable (its question 9: `board` and `history`) has a tool with
  `reader: true`. These two names are the census's one hand list, `READABLE_DOORS`, so E3 cannot go green on a tool
  nobody can read through.

W2's band-3 settle door (`POST /api/overlord/inbox/settle`, word `overlord-v1`) is bound by the same census: its piece
adds its client row, its table row and its tool in its own pull request.

The client's cap-reader census (`server/test/census-w3/claimant.ts#capReaderCalls` and `claimant.test.ts`) changes in
the same commit (ruled, F6). The table's check line becomes
`if [[ -n "$gate" ]] && ! _api_server_cap "$gate" && _api_server_cap ''; then`. Its guard rule counts the table's own
non-empty test, `-n "$gate"`, as a guard, and the pinned line changes to the new text. The count stays seven calls, none
unguarded but the review-rounds loop.

## Global Constraints

- **SAFETY.** No ccd verb, no tmux, no registry write, no unit. Tests use fixture HOMEs (`makeCcdHarness`, or the
  client harness `ccrc-api-timer.test.ts` uses). No live `$HOME`.
- **One owner per fact.** The word's one owner is `SERVER_CAP_MAP`. The console's constant is typed against it, and the
  client's table is held to `OVERLORD_DOORS` by a census, never by a second list that nobody checks.
- **No second mechanism.** The client gate extends the existing table and check. The card section is a renderer arm,
  with no new door.
- **No overloaded null.** `CardFacts.messages?` has three readings (ruled, F5): absent (this card is not the Overlord's,
  and its renderer does not ask), read (a list, possibly empty) and `unmeasured` (the store could not be read, the
  server has none, or a stored Overlord snapshot lacks the field). On the Overlord's card it is always present.
- **No operator text on the card** (question 2).
- **Wire discipline.** Additive only. `FLEET_PROTO` is not touched.
- **Mutation floors.** `renderCard` stays in `MUTANT_SETS`. Task 1 adds mutants to `server/test/sim/cardMutants.ts`,
  each with a killing case: the Overlord's arm answering the old one line; the Overlord's `BODY_FACTS` row gaining
  `timers`; the messages lines written `keep: false`; the cap's ids-and-count arm removed; and the snapshot reader
  reading an absent `messages` on an Overlord snapshot as read and empty. Its floor in `mutation-floors.json` stays 1.
  No new L1 module.
- **Growth.** Only one growth-checked file changes: `shared/api.ts`, by at most 1 code line (Table 5). Measured by the
  growth check's own stripper, it stands at 5,139 code lines (plan review 3877), so the +1 reaches the cap of 5,140
  exactly and passes (the check is "at or under"). If `main` grows before the build, the row goes on `continuity-v1`'s
  line instead.
- **Public repository.** No private name in code, tests, commits or the PR body. `CLAUDE.md`'s bullet names files and
  counts only.
- **Tests.** Every test and typecheck runs through `ccrc test -- …`. The PR's fast run covers the server tests it
  relates to. The pwa suite runs whole for the console's constant.

## Review Focus

- **Completeness.** Every row of Table 1 is either changed or shown to need no change, and every red case exists. A
  door with the word and no client row, a client row with no door tool, or a readable door whose tool is not
  `reader: true`, reds Task 2's census.
- **Reversibility.** The runbook (Retire, then revert) is in the PR body. The bound-Overlord revert is described, not
  hidden.
- **The card.** The unsettled list is never trimmed, carries no text, and lists ids with a count past its cap. Every
  non-Overlord card's text, snapshot JSON and snapshot id are byte for byte what they are on `main`, held by the
  existing render cases and Task 1's snapshot case. Timers stay off the Overlord's never-empty list.
- **No decision in delivery.** `server.ts` and `index.ts` are untouched. `continuity/routes.ts` changes by one
  type-only edit, its deps field `operatorModel` widened to the gatherer's `CardMessagesPort`; no logic line moves. The
  notes' port, `NoteKeysMessages`, is not widened.
- **The client's fail direction** matches every other gate: a current file refuses, and an absent, stale or torn file
  sends.

## Tasks

### Task 1: The word, the step-2 case and the Overlord's card

**Files:**
- Modify: `shared/api.ts` (`ServerCap` gains `'overlord-v1'`, edited in place on the union's last line; `SERVER_CAP_MAP`
  gains its row and doc comment, after `continuity-v1`).
- Modify: `shared/continuity-card.ts` (`CardMessage`, and the optional `CardFacts.messages?`).
- Modify: `server/src/continuity/cardFacts.ts` (the port `CardMessagesPort`, declared here; the gather for the
  `overlord` renderer only, mapping the store's `why` to the card's `what`).
- Modify: `server/src/continuity/routes.ts` (one type-only edit: the deps field `operatorModel` takes
  `CardMessagesPort & Partial<ReadLedgerCount>`; no logic line changes).
- Modify: `server/src/continuity/card.ts` (`CARD_OVERLORD_LINE` removed; `CARD_OVERLORD_NOTHING_LINE` and
  `CARD_CONSTITUTION_LINE` added; `MESSAGES_CAP_BYTES` and `messagesSections`; the Overlord's `BODY_FACTS` row and its
  arm in `renderCard`, `nothingSections` and `bodyOf`; `snapshotFactsOf`'s rule for `messages`).
- Not modified: `server/src/continuity/noteKeys.ts` (`NoteKeysMessages` stays as narrow as it is);
  `server/src/continuity/probeSchedule.ts#spotFactsOf` (its facts are never rendered as a card, so they leave
  `messages` absent); the nine test and simulator fixtures that build the `CardFacts` literal (the field is optional, so
  they type-check unchanged).
- Test: `server/test/overlord-v1-word.test.ts` (new); `server/test/continuity-card-render.test.ts`;
  `server/test/continuity-card-facts.test.ts`; `server/test/sim/cardMutants.ts`.
- Modify: `server/test/overlord-gate-doors.test.ts` (its stale "one fixed line today" comment only).
- Unchanged but re-run: `server/test/sim/mutation-floors.json` (the floor of `renderCard` stays 1).

**Interfaces:**

```ts
// shared/continuity-card.ts
/** One unsettled operator message on the Overlord's card: facts only, never its text (the plan's question 2). */
export interface CardMessage {
  readonly id: number; readonly at: number; readonly term: number; readonly state: string; readonly cut: boolean;
}
// CardFacts gains:
/** The private store's unsettled messages. Present on the Overlord's card only, read or unmeasured; absent on every
 *  other card, so no other snapshot's JSON or id moves (ruled, F5). */
readonly messages?: Fact<readonly CardMessage[]>;

// server/src/continuity/cardFacts.ts
/** The private store's reads the card makes: a `message` note key's owner, and the Overlord's unsettled list. */
export type CardMessagesPort = Pick<OperatorModelStore, 'messageSessionOf' | 'unsettledFacts'>;
// CardFactsDeps.messages becomes:
readonly messages?: () => CardMessagesPort | null | undefined;

// server/src/continuity/card.ts
/** The Overlord's never-empty line (C51): what its renderer reads, never runs, claims or coordinator intent (F8). */
export const CARD_OVERLORD_NOTHING_LINE = 'No unsettled operator messages, notes or checkpoint were measured for this session.';
/** The messages block's cap, as `TIMERS_CAP_BYTES` caps the timers block: past it the block lists the ids and how many
 *  lines it left out (I8). An input of `messagesSections`, so a case can pass a small one. */
export const MESSAGES_CAP_BYTES: number;
export function messagesSections(f: CardFacts, capBytes?: number): readonly CardSection[];
```

- [ ] **Step 1: Write the failing word case.** In `server/test/overlord-v1-word.test.ts`, build the gate's facts with
  `passFacts` from `server/test/sim/gateSets.ts` (the pure decider's fact builder; `overlord-gate-run.test.ts` drives the
  L4 runner through a Fastify and database rig instead):
  - `SERVER_CAPS` contains `'overlord-v1'`;
  - for every row of `OVERLORD_DOORS` with `group: 'overlord'` and `word: 'overlord-v1'` (`link-team` included), the
    decider `overlordGate`, given `passFacts(row, { serverWords: SERVER_CAPS })`, does not refuse at step 2;
  - every W1 word on a door row (`continuity-v1`, `timers-v1`, `overlord-v1`) is in `SERVER_CAPS`.
- [ ] **Step 2: Run it and see it fail.**
  `ccrc test -- ./node_modules/.bin/vitest run test/overlord-v1-word.test.ts` from `server/`. Expected: all three cases
  fail, the second with `capability-missing` at step 2 on each of the five rows on `main`.
- [ ] **Step 3: Add the word.** Add `| 'overlord-v1'` in place on the union's last line. Add the row
  `'overlord-v1': true,` with a doc comment that states the promise: the Overlord's own doors pass step 2, `ccrc-api`'s
  Overlord rows send, the card renders the Overlord's W1 card, and the console draws the Overlord; added by the change
  that completes W1, cut after every other W1 piece. If the growth check measures over the cap, put the row on
  `continuity-v1`'s line (the precedent is `'plan-phases-v1': true, 'plan-inbound-v1': true`).
- [ ] **Step 4: Run it and see it pass.** Same command. Then run `overlord-doors-census.test.ts`,
  `overlord-inbox-routes.test.ts`, `overlord-history-door.test.ts`, `overlord-inbox-wake.test.ts` and
  `linking-overlord-confirm.test.ts`. They inject their words, so they stay green unchanged.
- [ ] **Step 5: Write the failing card cases.** In `continuity-card-render.test.ts`, remove the pin of
  `CARD_OVERLORD_LINE` and write:
  - the Overlord's card for facts with two unsettled messages, one pending timer and one note renders, in order: the
    role line, the authority line, the constitution line, the messages section (one line per message: id, time, state,
    and "(cut)" when `cut`), the timers section, the notes section and the history line;
  - no card text contains "ships with W1";
  - `messages: { kind: 'unmeasured', what: 'the private store could not be read' }` renders a line that names the read
    as unmeasured, never "no messages";
  - read and empty everywhere renders `CARD_OVERLORD_NOTHING_LINE`, and never `CARD_NOTHING_LINE`;
  - **timers only:** an Overlord card holding only pending timers carries `CARD_OVERLORD_NOTHING_LINE` and its timers
    section (timers are not body facts, F8);
  - **the cap:** `messagesSections(f, 64)` over five messages lists every id on one kept line and says how many lines it
    left out; under the cap it lists one line per message. Both outputs are `keep: true`;
  - **the trim:** `trimCard` over the Overlord's sections at a small budget keeps every message id;
  - every other renderer's text is unchanged for the existing fixtures, which carry no `messages`.
  Update the two other cases that pin the one-line Overlord card (A4): the case "every renderer but the Overlord's one
  line carries the section…" now expects the timers section on the Overlord's card too, and the never-silent sweep no
  longer filters `overlord` out, so the Overlord's C51 behaviour is swept with the others.
- [ ] **Step 6: Write the failing snapshot cases.** In the same file:
  - a non-Overlord card's `snapshotFactsJson` has no `messages` key, and its snapshot id equals the id it had on `main`
    for the same fixture (a pinned sha256);
  - an Overlord snapshot written with `messages` reads it back field for field;
  - an Overlord snapshot without `messages` reads `{ kind: 'unmeasured', what: "the snapshot's messages" }`;
  - a non-Overlord snapshot without `messages` reads it absent.
- [ ] **Step 7: Write the failing gather cases.** In `continuity-card-facts.test.ts`:
  - a session whose renderer is `overlord` gets `messages` from `unsettledFacts()`, each row mapped field for field;
  - a store read that answers `{ kind: 'unmeasured', why }` gives `{ kind: 'unmeasured', what: why }`;
  - an absent store gives `{ kind: 'unmeasured', what: 'no private store on this server' }`;
  - every other renderer gets no `messages` field, and the store is not asked (a spy counts zero calls).
- [ ] **Step 8: Write the mutants.** In `server/test/sim/cardMutants.ts`, add a mutant for each of: the Overlord's arm
  answering the old one line; the Overlord's `BODY_FACTS` row gaining `timers`; the messages lines written
  `keep: false`; the cap's ids-and-count arm removed; and the snapshot reader reading an absent `messages` on an
  Overlord snapshot as read and empty. Each is killed by a case of Steps 5 and 6.
- [ ] **Step 9: Run them and see them fail.** Run both suites through `ccrc test`.
- [ ] **Step 10: Implement.**
  - `CardMessage` and the optional field.
  - `CardMessagesPort` in the gatherer, and the routes file's deps field widened to it. The gatherer calls
    `unsettledFacts()` only once the renderer reads `overlord`.
  - In `card.ts`: remove `CARD_OVERLORD_LINE`. The Overlord's `BODY_FACTS` row is `messages`, `notes` and `checkpoint`
    (`BodyFact` gains `messages`); `nothingSections` gives the Overlord `CARD_OVERLORD_NOTHING_LINE` and every other role
    `CARD_NOTHING_LINE`. `renderCard`'s Overlord arm: the role section, the authority line rule, a stable constitution
    line, then `messagesSections`, `timersSections`, `notesSections`, `checkpointSections` and `historySections`.
  - `messagesSections(f, capBytes = MESSAGES_CAP_BYTES)` emits `keep: true` sections only. Past the cap it emits the ids
    on one kept line and the left-out count. `MESSAGES_CAP_BYTES` is sized as the timers cap is: one message line's
    widest render times the count at which the operator's unsettled list is far past normal use (the builder states
    the figure in the constant's comment).
  - `snapshotFactsOf`: when `messages` is present, read it with `fact('messages', …)`; when absent, leave it absent for
    a non-Overlord role, and read `{ kind: 'unmeasured', what: "the snapshot's messages" }` for the `overlord` role.
- [ ] **Step 11: Run every card suite and the floor.** `continuity-card-render`, `continuity-card-facts`,
  `continuity-anchor`, `continuity-card-route`, the test typecheck
  (`ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json`), and the mutant floors
  (`ccrc test -- ./node_modules/.bin/vitest run test/sim/mutation-floors.test.ts`). The floor of `renderCard` stays 1.
- [ ] **Step 12: Commit.** `feat(overlord): the overlord-v1 word and the Overlord's W1 card (Overlord W1, overlord-v1 Task 1)`.

### Task 2: The client, the console's constant and the skill's bullet

**Files:**
- Modify: `ccd/ccrc-api` (the gated table's rows; the check's condition becomes `[[ -n "$gate" ]]`; the header comment's
  list of gates, in a line that does not start with `# <word> rows`).
- Modify: `server/test/census-w3/claimant.ts` (`capReaderCalls`' guard rule counts the table's own non-empty test) and
  `server/test/census-w3/claimant.test.ts` (the pinned line).
- Modify: `pwa/src/overlord/homePlace.ts` (`OVERLORD_CAP: ServerCap`, type-only import).
- Modify: `CLAUDE.md` (the `ccrc-overlord` bullet, after the reviewer bullet).
- Modify: `server/test/overlord-skill.test.ts` (the count-word scan reads `CLAUDE.md` too).
- Test: `server/test/ccrc-api-overlord-word.test.ts` (new); `pwa/test/overlord-home-place.test.ts`.

- [ ] **Step 1: Write the failing client cases.** In `ccrc-api-overlord-word.test.ts`, with the harness
  `ccrc-api-timer.test.ts` uses (a fixture HOME, a recording server):
  - for each gated Overlord row on `main` (`overlord.inbox`, `overlord.messages`, `overlord.acknowledge`,
    `overlord.history`, `linking.confirm`), a current cap file of today's words less `overlord-v1` answers
    `{ok:false, error:'capability-missing'}` with the detail naming `overlord-v1`, exit 2, and the server records no
    request;
  - a current file with the word sends;
  - an absent file sends, and so does a stale one;
  - a `plan.*` row's refusal is unchanged (the check now reads the whole table).
- [ ] **Step 2: Write the failing census.** In the same file, the four checks of "The client": parse `ROUTES` and the
  gated `case` block from `ccd/ccrc-api`'s text, import `OVERLORD_DOORS` and `DOOR_TOOLS`, and hold `READABLE_DOORS`
  (`board`, `history`). No exception list. At the build's base every Table 3 piece has merged, so the census is green
  only once the client rows are added (Step 4); before Step 4 the second check is red on all seven rows.
- [ ] **Step 3: Update the cap-reader census.** In `claimant.ts`, the guard rule also counts `[[ -n "$gate" ]]` before
  the call; in `claimant.test.ts`, the pinned sixth line becomes
  `[true, 'if [[ -n "$gate" ]] && ! _api_server_cap "$gate" && _api_server_cap \'\'; then']`, and the comment above it
  says the table gate is guarded by its own non-empty test. Run `claimant.test.ts`: red until Step 4.
- [ ] **Step 4: Implement the client.**
  - Add the Overlord rows to the `case` block, each setting `gate='overlord-v1'` and the one detail text.
  - Change the check's condition from `[[ "$key" == plan.* && -n "$gate" ]]` to `[[ -n "$gate" ]]`.
  - Add one line to the header comment's list of gated rows, not starting with `# <word> rows`.
- [ ] **Step 5: Run them and see them pass.** `ccrc-api-overlord-word.test.ts`, `census-w3/claimant.test.ts`,
  `ccrc-api.test.ts` (its header anchor is still unique), `ccrc-api-closed.test.ts`, `ccrc-api-inbox.test.ts` and
  `ccrc-api-timer.test.ts`.
- [ ] **Step 6: The console's constant.** Type `OVERLORD_CAP` as `ServerCap` through a type-only import, and rewrite
  its comment so it no longer says the row is to come. Add `expect(SERVER_CAPS).toContain(OVERLORD_CAP)` to
  `overlord-home-place.test.ts`. That case is already green once Task 1 Step 3 adds the word, so it is not written red
  first: the hold is the `ServerCap` annotation, which a revert of the map row turns into a type error (A6). Run
  `ccrc test -- npx tsc --noEmit` and the pwa suite whole (`ccrc test -- ./node_modules/.bin/vitest run` from `pwa/`).
- [ ] **Step 7: The skill's bullet.** Write the failing scan.
  - In `overlord-skill.test.ts`, the README case's marker loop also runs over `CLAUDE.md`, and expects at least one hit
    there. Red until the bullet is added.
  - Then add the bullet to `CLAUDE.md`, beside the worker and reviewer bullets: "So does the Overlord
    (`ccd/overlord-skill/SKILL.md`, `ccrc-overlord`, twenty-two clauses pinned by `server/test/overlord-skill.test.ts`).
    It goes in no home: it is staged at `~/.cc-sessions/overlord-skill`, only the `overlord` launch profile loads it,
    and it acts only while the server advertises `overlord-v1`."
  - Run `overlord-skill.test.ts`, `skill-size-ratchet.test.ts` and `box-token-census.test.ts`. The last reads only its
    own bullet passages of `CLAUDE.md`, so the new bullet does not touch it.
- [ ] **Step 8: Commit.** `feat(overlord): ccrc-api and the console follow overlord-v1; the skill's CLAUDE.md bullet (Overlord W1, overlord-v1 Task 2)`.

## The PR split

One pull request, two tasks, lane C, last of all (the index). Its tests: the server tests vitest relates to the change,
the guard suites, the test typecheck, and the pwa suite whole (a `pwa/src` change). It changes no `docs/` file but this
plan's (merged before it), so it is not docs-only. The builder pushes once, after both tasks.

### Table 5. Growth, against `main` at `4fa87d73f8`

| File | Growth-checked | Estimate | Note |
|---|---|---|---|
| `shared/api.ts` | yes, capped at 5,140 code lines | +1 code line (0 on the fallback) | 5,139 by the growth check's own stripper (plan review 3877), so +1 reaches the cap exactly and passes. The union line is edited in place |
| `shared/continuity-card.ts` | no | +6 | |
| `server/src/continuity/card.ts` | no | +60 | the renderer arm, the nothing line, the messages section and its cap, the snapshot rule |
| `server/src/continuity/cardFacts.ts` | no | +10 | the port and the gather |
| `server/src/continuity/routes.ts` | no | 0 | one type edited in place |
| `ccd/ccrc-api` | no (not in `GROWTH_FILES`, not a `ccd/lib` library) | +20 | seven case rows of two lines, one condition, one comment line |
| `pwa/src/overlord/homePlace.ts` | no | +1 | |
| `CLAUDE.md` | no | +4 | |
| Tests | no | about +340 | two new files; `continuity-card-render`, `continuity-card-facts`, `cardMutants`, `claimant.ts`, `claimant.test.ts`, `overlord-skill.test.ts`, `overlord-home-place.test.ts` and one comment in `overlord-gate-doors.test.ts` edited |

No other growth-checked file changes: `server/src/server.ts`, `index.ts`, `watch.ts`, `coord/store.ts`, `schema.ts`,
`coord/routes.ts`, `pwa/src/lib/api.ts` and `ccd/session-hook.sh` are untouched. No migration.

## Deviations found

These are departures from the spec's or the index's text that this plan makes, by slug. The coordinator mints the
numbers.

- **`overlord-v1-is-held-at-both-ends`** (question 1): the index's question 33 reads as console-only. The Overlord's own
  doors also hold the word at step 2, as §11.2 says. The operator's doors carry no word.
- **`card-lists-message-facts-not-text`** (question 2): §3.3.3 says the card "lists every unsettled message". The card
  lists each one's facts and id, and the text is read through the `messages` door and its ledger.
- **`w1-card-renders-what-w1-has`** (question 3): §3.3.3's seven parts. W1's card renders the parts whose facts exist,
  and each later wave adds its own section.
- **`overlord-nothing-line-names-its-facts`** (question 3, ruled F8): C51's line names runs, claims and coordinator
  intent. The Overlord's card has a nothing line of its own, naming messages, notes and the checkpoint, and timers stay
  off its never-empty list, as `timers-are-not-body-facts` settled for every role.
- **`card-messages-field-is-optional`** (ruled, F5): the card's facts gain `messages` on the Overlord's card only, so no
  other snapshot's JSON or id moves, and a stored Overlord snapshot without it reads `unmeasured`.
- **`card-renderer-held-by-the-build`** (question 4): §7.5 and §11.5 name "the hook's card arm". There is none, and
  the server's renderer is held by the build.
- **`client-word-gate-is-one-table`** (question 5): the Overlord rows join the client's existing table of gated rows,
  whose check now reads every row; the client's cap-reader census counts the table's own non-empty test as its guard.
- **`overlord-v1-waits-for-the-door-tools`** (question 8, ruled F1): the index's needs for this piece gain the door
  tools `board` and `history` (riding board B2) and `sequence` (riding sequence C).
- **`overlord-v1-waits-for-chat-b`** (question 7, ruled F3): the chat plan says this piece need not wait for chat B.
  It waits, as the index says, so every reply is recorded from the Overlord's first turn.
- **`plan-at-the-dated-path`**: the index names this plan `2026-11-14-overlord-w1/w1-overlord-v1.md`. It is
  `2026-11-25-overlord-w1-overlord-v1.md`, directly in `docs/superpowers/plans/`, because the review judge refuses a new
  plan in a subdirectory (`spec-misplaced`).
- **`merge-waits-for-the-w1a-arming`** (question 12): the index puts the W1a arming before the first designation. This
  plan also puts it before the merge, with the `anchor-slot` lane live among it (ruled, F2).

## Index changes, for the coordinator to fold

- Table W1, row `overlord-v1`: the plan is written, at `docs/superpowers/plans/2026-11-25-overlord-w1-overlord-v1.md`,
  not `2026-11-14-overlord-w1/w1-overlord-v1.md`: the review judge's layout puts a new plan directly in
  `docs/superpowers/plans/` under a dated name, as the Overlord clause's plan did. Its needs gain the door tools `board`
  and `history` (board B2) and `sequence` (sequence C), and chat B (ruled, F1 and F3).
- Table W1, rows "Board and history door" and "Sequence and monitor": B2 ships the `board` and `history` door-process
  tools, each `reader: true` (the history tool is ticket `history-door-process-row`); sequence C ships the `sequence`
  tool.
- W2's band-3 settle door (`POST /api/overlord/inbox/settle`, word `overlord-v1`) is bound by this piece's client census:
  its piece adds its client row, its gated-table row and its door tool.
- Question 33: add "Question 33's 'no separate server-side gate' is the operator's doors. The Overlord's own doors
  refuse `capability-missing` at step 2 until the word stands."
- The prerequisites table (`continuity-v1`, "not started") and the sentence "`continuity-v1` (W1a, not yet built)":
  `continuity-v1` is merged and in `SERVER_CAP_MAP`.
- The capability table's `overlord-v1` row: "the card carries no Overlord line" becomes "the card carries one
  placeholder line".
- The Overlord clause's row: merged as coordinator clause 24 (#3354).
- "What a merge arms": the first designation also waits for the `anchor-slot` lane to be live, and for sign-in armed.
- "Where things stand", Later: drop `w1-overlord-v1.md` from the plans not yet written, and add the checkpoint's reader
  of the Overlord's replies as a row with no owner.
- The ledger (`docs/superpowers/programs/overlord.md`): its two lines that call `continuity-v1` not started (the
  coordinator corrects them on #3403).
- **Spec fixes for the spec-fixes run:**
  - §7.5 and §11.5's "the hook's card arm" becomes "the card door's Overlord renderer".
  - §3.3.3's "lists every unsettled message" becomes "lists every unsettled message's id and facts".
  - §3.3.3's never-empty rule names the Overlord's own nothing line.
  - The W1 row of §14 names the `history`, `board` and `sequence` door tools as part of the door process's W1 tools.

## Where things stand

**Agreed:**
- The word is one row of `SERVER_CAP_MAP`, added last of all W1 pieces but the Overlord clause, which has merged.
- The console's hiding is built (home A). This piece types its constant.
- The card's unsettled list belongs to this piece (the private-store plan's question 15).
- The `CLAUDE.md` bullet belongs to this piece (the skill plan's slug `overlord-skill-prose-in-readme-only`).
- Entry row E9's predicate is I7 (the coordinator's ruling, call 1286).
- The plan's dated top-level path (the judge's layout) and the judge's editorial bound on a one-file plan are accepted.
- Plan review 3877 and call 1340: every question ruled (1 to 6 and 9 to 11 as recommended; 7, 8 and 12 as stated);
  F1 to F8 and A1 to A7 applied in edit round 1.

**Waiting on the coordinator:**
- The narrow review of edit round 1.
- The index changes above.

**Later:**
- The build, once every row of Table 3 has merged.
- The checkpoint's reader of the Overlord's replies: no plan builds it, and it has no owner yet (the coordinator adds a
  ticket). Chat B records the replies; the piece that assembles the Overlord's checkpoint would read them.
- W2 adds `overlord-route-v1` the same way: its rows join the client's table under their own word, and its census reads
  the word from the row.
