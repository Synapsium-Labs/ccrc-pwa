# Overlord W1: `overlord-v1`, the task note

Run 4149, wave 250. Plan: `docs/superpowers/plans/2026-11-25-overlord-w1-overlord-v1.md`, built on `main` at `07e8cc51e1`
with the coordinator's rulings of the brief, call 1887 (the lane guard) and the ruling on Table 11.6. No deviation number
was allocated, so departures are named by slug. The coordinator folds this note into the ledger.

## In short

- The server advertises `overlord-v1`. The Overlord's own seven doors pass step 2 of the gate (step 1 still refuses every
  caller but the designated session), `ccrc-api`'s seven Overlord rows follow the word through the client's one table of
  gated rows, the card door renders the Overlord's W1 card, and the console's constant is typed against the server's word
  list.
- A guard joins the piece (call 1887): Start the Overlord, and a rebind that starts a body, refuse the new word
  `overlord-lanes-unarmed` while one of the three lanes the body needs is not live, and refuse `capability-missing` naming
  `overlord-history` while agent links exist and none, or more than one, serves the history op.
- The flip changes nothing while nobody is designated, except that Start appears and the guard stands in front of it.

## 1. Step 0, measured on `main` before any edit

| Row | What the plan says | What `main` has |
|---|---|---|
| Growth of `shared/api.ts` | 5,139 code lines, so +1 fits the cap of 5,140 | **5,140** by the growth check's own stripper (`growthCheck.ts#codeLines`): at the cap. The plan's fallback is taken: the union member in place on the union's last line, the map row on `continuity-v1`'s line. Net growth 0 |
| The door rows that carry the word | seven, two of them not on main | seven, counted from `OVERLORD_DOORS`: `link-team`, `inbox`, `messages`, `acknowledge`, `history`, `sequence`, `board` |
| The client rows | `sequence` named bare | `linking.confirm`, `overlord.inbox`, `overlord.messages`, `overlord.acknowledge`, `overlord.history`, `overlord.sequence` (not bare), `overlord.board` |
| The door tools and their reader flag | `history`, `board`, `sequence` owed by B2 and C | `link_team`, `inbox`, `messages`, `acknowledge`, `history`, `sequence`, `board`, each with its client row's key as its verb. Reader flag set on `board` and `history` only |
| What the read tool admits | history fenced and refused, so E3 red until B2 | `readableDoorRow` is already exported and called by the read tool (board B2). The history door is now `write: false` and its tool unfenced, so the read tool admits both `board` and `history`: E3 is green at build. Call 1590 settled both as attributed reads, and the code does exactly that (an unfenced view, its ceiling counting every attributed read) |
| `ROUTES` rows | 102 plus two | 105 |
| The placeholder card line | stands | stands: `CARD_OVERLORD_LINE`, pinned in the card's render test and named in one comment of the gate-doors test |
| The routes file's deps field | the notes' narrow port | as the plan says |
| The console's constant | a bare string | as the plan says |
| The `CLAUDE.md` bullet | absent | absent |
| Table 3 | ten pieces | all merged with their symbols found, except chat B (`recordReply`, `overlord_replies` absent), as the brief said |

### Table 1, row by row

| # | Answer on this branch |
|---|---|
| H1 | the row and the union member, by the fallback (above) |
| H2 to H9 | one case drives the pure gate with the production `SERVER_CAPS` for every door row of the word (`overlord-v1-word.test.ts`), with a control under the list less the word |
| H10 | the client's table gains one row of seven keys; its check reads every row (`[[ -n "$gate" ]]`) |
| H11 | no change: each tool runs its client row, and the census holds tool, row and door together |
| H12, H13, H14 | the W1 renderer, the messages section with its cap, and the timers on the Overlord's card |
| H15 | `OVERLORD_CAP: ServerCap`, a type-only import; `SERVER_CAPS` contains it (a pwa case) |
| H16 to H19 | no change: home A, home B, home C and chat A read `overlordShown`, and their suites already stand a server advertising the word |
| H20, H21 | held by the build, no change |
| H22 | the bullet, and the skill test's count scan reads `CLAUDE.md` too |
| H23 | `overlord-v1-word.test.ts`: every W1 word on a door row is in `SERVER_CAPS` |

### Tables 2a and 2b, row by row

| # | Answer |
|---|---|
| F1 | nothing in the hook, as ruled; the spec fix stays the coordinator's |
| F2 | built (the client's table) |
| F3 | now refused in part by the product: the designate door refuses a Start whose lanes are not live (the guard). A designation made before this merge is still not refused by the word (question 10) |
| F4 | all three tools are on `main`, readable exactly as ruled; the census holds them |
| F5 | home B's readiness lines read `overlordShown`, measured |
| G1 | stands: `link-team` moves from step 2 to step 10 (`rung-below` at `chat`) |
| G2 | the new word case reads `SERVER_CAPS` itself |
| G3 | stands: a designation made through the API before this merge holds the wake until the word stands |

## 2. Holds on the word beyond Table 1

Searched on `main`: the word's string, `OVERLORD_CAP`, every "later in W1" marker, and every test pinning the placeholder.

| Hold | Where | Answer |
|---|---|---|
| The placeholder's pin | `continuity-card-render.test.ts` | removed and replaced by the W1 card's cases |
| The placeholder named in a comment | `overlord-gate-doors.test.ts` | the comment rewritten |
| "Without `overlord-v1`" cases | the console's suites (chord, readiness line, phone bar), `overlord-inbox-wake`, `overlord-read-doors-wiring` | stay: each injects its own word list or caps read, so each still proves the hiding. They passed unchanged |
| The console's comments that say "drawn only under `overlord-v1`" | `pwa/src` | stay: true after the flip |
| The renewal lane's `readersRunning: later('W1')` for the Overlord | `generationsLane.ts` | stays: a fallback only. The renewal readings' own `readersRunning` (PR E) is spread after it, so the reading is the hook's reports |
| `mailPace.ts`'s "read by no live session until W1's designation reader" | comment | stays: true until a designation exists |
| `ccrc-api`'s `capability-missing` for `plan.*` rows | the same table | unchanged, a case holds it |

## 3. What the merge turns on with nobody designated

- `GET /health` gains the word, and the cap files follow within a minute on each node.
- No door answers differently: step 1 refuses every caller `not-the-overlord`. The client's seven rows send instead of
  refusing locally, and the server answers them `not-the-overlord`.
- No session's card changes: no role reads `overlord`, and every other card's text, snapshot JSON and snapshot id are byte
  for byte main's (a pinned sha256 case for four renderers).
- The console opens the place and its Start (home B), Settings › Overlord (home C), `/overlord` and the palette's "Go to
  Overlord". `/` stays on the Fleet.
- Start now refuses `overlord-lanes-unarmed` while a lane is not live, and `capability-missing` naming `overlord-history`
  while agent links exist and none or several serve it.

## 4. The guard (call 1887)

- **The word.** `overlord-lanes-unarmed`, 409, in `shared/refusal.ts`'s Overlord group. Its Table 11.6 row lands with this
  pull request (ruled (a): the refusal table's guard is two-way, and `codeOnly` may only shrink).
- **The answer.** `{ ok:false, error, detail, lanes }`: only the lanes that are not live, in the fixed order (continuity,
  launch-profile, anchor-slot), each `{ lane, reads }` with `shadow`, `gated` or `unread`. The store's own detail for an
  unread row is one server log line, never on the wire.
- **The owner.** The door's port gains the store's one reader of a lane-arm row (`laneArmSetting`); each row becomes its view
  through the lane-arm owner's `laneArmRowViewOf`; the decider maps views to readings (`laneReadingOf`) and decides. A read
  that throws is the owner's unreadable row. The absent store's reader answers unreadable.
- **The order.** Step 3b, between the builds and the set's spelling, shared by rebind. A standing designation still answers
  `overlord-exists` first. The lanes are read once per Start or Rebind request (a side-effect-free row read), and the answer
  of a request step 1 refuses is unchanged. Restart, Retire, the designation read, the model class, the account set, the rung
  and Pause never read them: a census and two spy cases hold it.
- **E18.** The words' arm adds `overlord-history` to `needs` when the history door's own chooser (`historyAgentFor`) over the
  agent links finds none or several serving it, the detail naming which. Zero links is the server's configuration (local mode:
  the links the chat's dependency carries are empty exactly when there is no fleet state), so it is not asked. The door could
  tell the two apart through what it already holds, so this is no Known limit.
- **The console.** One sentence and the lanes by the Shadow lanes card's row names. A lane list it cannot read draws the
  sentence alone (departure below).

### The entry checklist after the guard

| Row | Who holds it now |
|---|---|
| E1, E16 | the coordinator, at landing |
| E8 | shown: the readiness line on the place, Fleet health and Waiting on you |
| E9 | shown: the Shadow lanes card's invariants row and the operator's invariants read |
| E10 | shown on the Shadow lanes card; refused in effect while the lanes are not live, because the Shadow lanes door refuses `baseline-missing` when one of the three W1a lanes is set live without a confirmed baseline. A baseline withdrawn after the lanes went live is not caught |
| E11 | **refused** by the guard |
| E12, E20 | shown by doctor (the update's own doctor run) |
| E13 | refused: `capability-missing` (ccd's words) and `launch-profile-unmet` (builds) |
| E14 | the designation half refused (`overlord-exists`); pending Overlord timers, items and message rows shown, not refused (ruled: build none) |
| E15 | shown: the place's ladder part draws a standing latch |
| E17 | refused: the designate door asks the account gate with a step-up, which refuses `auth-off` while sign-in is dark |
| E18 | **refused** by the guard, when agent links exist |
| E19 | refused in effect: `agreed` builds mean the fleet runs the server's own build, which carries every Table 3 merge |

## 5. The card

- The unsettled list is facts only (id, time, term, state, cut), never text, in id order, one kept section, never trimmed.
  Past `MESSAGES_CAP_BYTES` (fifty of the widest lines, 22,000 bytes, about 6,900 tokens) it keeps the lines that fit and
  names every id and how many lines it left out.
- The three readings of the messages fact are kept apart: absent (not the Overlord's card; on the Overlord's card it reads
  "Could not read the unsettled messages."), read (possibly empty), unmeasured (one of two fixed phrases; the store's reason
  is one server log line). The snapshot reader reads an Overlord snapshot without the field as unmeasured.
- **A message sent off the record** (chat A's mark) is listed like any other: the spec's §9.4 rule 9 says it "is still
  recorded and answered, but no feed learns from it", and the card is not a feed but the list of what the Overlord owes an
  answer to. The store's facts read carries no off-record column and the card adds none.

## 6. The design rule

The word, the client's table, the card and the guard are the product's own: server facts, the client's own table and the
server's renderer. Nothing added depends on one agent harness.

## 7. Departures, by slug

- `shared-api-growth-fallback`: `shared/api.ts` stood at its cap, so the map row is on `continuity-v1`'s line (the plan's
  own fallback); net growth 0.
- `sequence-client-key-is-namespaced`: the plan names the sequence's client row `sequence`; `main`'s is `overlord.sequence`.
- `readable-door-row-already-exported`: Task 2's move of the read tool's admit condition is skipped; board B2 made it.
- `history-readable-at-build`: E3 is green at build, not red, because board B2 unfenced the history door.
- `lane-guard-joins-the-flip` (call 1887): the guard, its word and its Table 11.6 row, and the `capability-missing` row's
  history clause.
- `lanes-read-before-step-1`: the lanes are read on every Start and Rebind request, then the decider decides in its order;
  a standing designation's answer is unchanged.
- `lane-list-unreadable-draws-the-sentence`: the console draws the sentence alone, never the bare word, for an
  `overlord-lanes-unarmed` answer whose lane list it cannot read; the sentence is still true and says where lanes are set
  live. (My proposal said "the bare word"; this is the one place the build differs, for the coordinator to rule.)
- `routes-file-type-edit-spans-imports`: the continuity routes file's one type-only edit is the field's type, its comment and
  the two import names it needs.
- `route-rigs-arm-the-lanes`: the designate and rebind route rigs set the three lanes live; no other fixture moves.
- `start-lanes-list-is-its-own`: `DESIGNATE_LANES` names the same three lanes as the replay quiz's `W1A_ARM_ROWS` today, and
  is kept apart on purpose (a recorded "legitimately different"): the quiz's list is the lanes its baseline guards, which any
  later W1a lane joins; this one is what a start needs, which a later lane joins only by a ruling of its own.

## 8. Mutation rows (before, then after)

| Set | Mutant | Before | After |
|---|---|---|---|
| `CARD_NEVER_EMPTY_SET` | V1 the Overlord answers the old one line; V2 timers as body facts; V3 messages droppable; V4 the cap drops the ids line; V5 an absent field read as none | not in the set | each killed (the floors run) |
| `CARD_NEVER_EMPTY_SET` | R1, R2 re-anchored on the new `silent` line | anchored on the old text | killed |
| `SNAPSHOT_FACTS_SET` | N35 an Overlord snapshot without messages read as none | not in the set | killed |
| `DESIGNATE_SET` | L1 a lane ignored; L2 unread as live; L3 gated as live; L4 no view as live; L5 lanes before the words; L6 lanes after the spelling; H1 many agents as served; H2 no link as none | not in the set | each killed |
| by hand, the client census | the reader equality weakened to a subset | (not built) | red: the synthetic table case |
| by hand, the client census | `readableDoorRow` answering true for every row | (not built) | red: the synthetic table case |
| by hand, the gatherer | the store's reason written into the fact's `what` | (not built) | red: three cases, the snapshot id one among them |
| floors | every floor in `mutation-floors.json` | 1 | 1 (none lowered, none added) |

## 9. Known limits

- A baseline withdrawn after the three lanes are live leaves them live, so a Start is not refused for E10.
- E14's pending rows are shown, not refused (ruled).
- The client's seven rows refusing locally is not in the spec's Table 11.6 `capability-missing` row, which names only
  `ccrc-api timer` on the client; the leave covered the history clause only, so that sentence is the coordinator's.

## 10. Verification

Each file alone through the fleet test wrapper, at most two workers. The figures and the runs are in the wave-done mail.
