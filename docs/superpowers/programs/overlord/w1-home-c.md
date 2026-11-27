# Overlord W1 home, PR C: notes for the ledger

Run 4037 built PR C of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-home.md`. That is Tasks 8 and 9: Settings › Overlord, each account's
billing fact and continuity record, and the account-hold Clear. It also carries four items from home B's second review (ticket
`home-c-carries-review-4021`) and the forced rebind's pair (ticket `forced-rebind-names-the-session-it-stops`, ruled calls 1675 and
1685). This note says:

- what the build made;
- what Step 0 measured and where `main` differed;
- where the build departed from the plan.

Each departure has a slug, and the coordinator mints its number when it folds this note into the ledger. Home A's note is
[`w1-home.md`](w1-home.md) and home B's is [`w1-home-b.md`](w1-home-b.md).

## Step 0: each door, by its merged name

Every door the plan lists as "not on `main` yet" is on `main`. Each card is drawn from its door's real answer.

| The plan's name | On `main` | What the door does |
|---|---|---|
| Retire | `DELETE /api/overlord/designate` | Asks the step-up (`stepUp: true`). Answers `{ changed, term, stopped, owed }`; `changed: false` when nothing was bound, which still drains owed stops |
| The model class | `POST /api/overlord/model` `{ model }` | `fable` asks the step-up and `opus` does not (`modelStepUp`). Answers `{ changed, model, warnings, route, written }`; `not-found` without a row |
| The account set | `POST /api/overlord/account-set` `{ accountPools }` | The door reads the row before the gate and asks the step-up for a widening (`accountSetStepUp`); a narrowing or a reorder needs none. Answers `{ changed, accountPools, accounts: { list, counted, unmeasured, holds }, warnings, orgSpread, route, written }`. `overlord-single-account` with `count` while a body is bound or pending |
| The backstop read and write | `GET` / `POST /api/continuity/renewal-backstop` `{ hour, zone }` | No step-up. `{ ok, hour, zone, isDefault, setAt }`. `bad-request` with a detail for an hour or a zone; `write-failed`; `unavailable` with the store's detail |
| The retention pair | `GET` / `POST /api/responses/retention` `{ days }` | The read answers `{ days, min, max, default }`, or `days: null` with `unreadable: true`. The write asks the step-up for a lowering and for any save over an unreadable value (`retentionChangeGate`); `bad-request` outside the bounds; `not-configured` with no store |
| The roster's billing and continuity fields | `RosterWire.fableBilling?` and `continuity?: { recordedAt }` (`shared/rosterFacts.ts`); saved through `POST /api/accounts/:id/set` with `fableBilling` or `continuity: 'on' \| 'off'` | The door asks the step-up for `included` and `on`, whatever is stored (`factsChangeWidens`) |
| The account holds' read and Clear | `GET /api/continuity/account-holds`; `POST /api/continuity/account-holds/:lane/clear` | The read answers `{ holds: [{ lane, cause, startId, heldAt }] }`, or `unmeasured` (502). Clear asks no step-up; `not-found` (404) when no hold stands |
| The hold item (plan F17) | The readiness lane's `hold` item, titled `<READINESS_ITEM_TEXT.hold.title>: <lane>` in the Overlord's item programme | The item's title is L0's own grammar ("A `hold` title is the prefix of `<title>: <lane>`"), so the item names its lane |

## Where main differed from the plan

- **An older fleet node's refusal is not a bare `unknown-argument`.** An older `ccrc account set` answers `unknown-argument`, and the
  account door carries any verb word outside its own list as `lane-act-refused` with `verbCode: 'unknown-argument'`. The card keys on
  that pair (`ACCOUNT_FACT_REFUSAL_TEXT.older`).
- **Retire asks the step-up at its door.** The plan's Global Constraints list Retire among the acts that lower authority. The console
  sends Retire through the section's one step-up, so the door's ask is followed, and nothing in the console adds or drops a step.
- **The account-set call already carried `org`.** Its body type was widened to the whole `RosterFactsChange`, which changed one line.
- **`responseRetention()` threw on a 404.** It now answers `absent` through `getJsonOrAbsent`, so an older server draws no card. No other
  caller read it.
- **The hold raises an item** (the readiness lane's `hold` kind), so the item's Clear is drawn beside the card's, as F17 asks.
- **A census holds every Overlord refusal word to the spec's Table 11.6** (`single-definition/refusal-table.test.ts`; `codeOnly` is
  shrink-only). The forced rebind's new word could not land without a spec row, so the door answers the existing
  `stale-designation` (ruled call 1685; below).
- **Main moved during the build** from `3fda0fc9b1` to `1f31f6133d`. The last merge of `main` is recorded under "Merges" below.

## What was built

- **The section (`pwa/src/screens/settings/OverlordSection.tsx`, L4).** A seventh Settings section, `overlord`, last in
  `SETTINGS_SECTIONS`. Its index row, its page and its "Go to Settings › Overlord" are drawn only under `overlord-v1`. Without the
  word, or before the word is read, `/settings/overlord` draws the index. Six cards, each a `Section` with its scope and purpose:
  - **The Overlord:** the binding's state, the place's link (Start, Open or Rebind are the place's), and Retire with its answer's
    `stopped` and `owed`;
  - **Model class:** the radios from `MODEL_CLASS_OPTIONS` (Start's one definition), Save, and "takes effect at the next renewal";
  - **Account set:** the checkboxes, then Save and Save again;
  - **Renewal backstop:** the hour and the zone, with "the default" beside the read's own values;
  - **Response retention:** the days, from the read's own bounds;
  - **Account facts:** one row per roster account, with its hold and Clear.
- **The gate (`overlordGateOf`, L1, plan question 3).** It keeps `absent`, `loading`, `unmeasured`, `none` and a row apart, and a stale
  read says when it was last read. `absent` draws one sentence and no card.
- **One step-up and one confirm for the section.** One `useStepUp` (acting first, `ASSUME_FRESH`). The one `ConfirmItsYou` is drawn
  inside the card whose act was refused `step-up-required`, so it is never mounted twice, and the operator presses the act again. A
  card keeps the operator's picks after a step-up or a refusal and clears them only on an answer.
- **The words (`pwa/src/overlord/overlordSettingsWords.ts`, L1).** The gate, the index's status line, each answer's one reader, the
  boxes and the edited set, and the backstop's, the retention's and the facts' words. It also holds the holds' reader and
  `holdLaneOfItem`.
- **One account-set fieldset (`AccountSetFieldset.tsx`).** Start (home B's body part) and the Settings card draw the same component,
  with the same `poolOptions` over the roster: one definition (ruling 3). The Settings card keeps the saved set's order: the saved
  pools first, a saved pool no account carries still drawn (so it can be switched off), then the other roster pools, then untagged.
- **One Clear (`pwa/src/overlord/AccountHoldClear.tsx`).** It is drawn by the card for a lane the holds read names, and by the item
  view for an open hold item's lane. It is sent once (an in-flight guard), and the button goes after an answer or `not-found`.
- **The refusals (`lib/refusalWords.ts`).**
  - `overlordSettingsRefusalText` sends the three designation doors through the place's table, except `not-found`. That word reads
    "no designation row" only after the store has answered; before an answer it says the door did not answer.
  - The backstop, the retention and Clear words draw the server's detail.
  - `accountFactRefusalText` covers the older node and `outcome-unknown`, and falls back to the lane acts' own sentences.
  - Every reader is keyed by the word through `Object.hasOwn`, so the literal-branch ratchet does not move.
- **The calls (`lib/api.ts`, +11 net lines, under the plan's +18):** `overlordRetire`, `overlordModel`, `overlordAccountSet`,
  `renewalBackstop`, `setRenewalBackstop`, `accountHolds` and `clearAccountHold`. Each answer is `unknown`, read by the words module.
  The account-set body is widened, and `overlordRebind` gains the optional pair.
- **The item view (`pwa/src/ledgers/ItemView.tsx`, by packet to its holder).** The hold item's Clear sits in "Your move", with the
  item's other acts, after History (ruled call 1684).
- **The stylesheet.** The `ovs-` rules in the place's `overlord.css`, tokens only, each ink with its ground.

### The carried items (ticket `home-c-carries-review-4021`)

- **4a.** The sign-in-off table said Pause and a lowered rung need sign-in; the server asks it only of a raise. Those two sentences are
  dropped, and the act table is `Partial`, so an act with no sentence draws the word raw (`Refused: auth-off`), never Start's sentence.
  Settings' three designation doors joined the table, because each asks the account gate.
- **4b.** The place's browser file asserts the readiness label in every state, by the state's own word, and its settle waits for the
  word itself. Its `measure` now reads the label inside the place. On a desk, the Fleet's one-line form carries the same hook and came
  first, so the old contrast check measured that line, not the place's chip.
- **4c.** The strip says `rank-changed` in its own words (`PORTFOLIO_WORDS.rankChanged`). It has already read the order again, so it
  does not tell the operator to, and the sentence is set only once that read has answered (`rankChangedUnread` otherwise). The Waiting
  on you table's sentence, "Read it again and reorder", is unchanged and pinned.
- **4d.** The "taking effect" line trusts a ladder read only when its call was issued after the door answered. The store numbers its
  ladder calls as it issues them (`ladderSeq`, the number of the call whose answer the read holds; `ladderIssued()`, the newest issued),
  and the door keeps `ladderIssued()` at its answer. Two device-clock stamps are gone. The same-millisecond case is pinned the other
  way: a read in flight when the door answered does not speak for it in the same millisecond or later, and the next call does.

### The forced rebind's pair (rulings 1675 and 1685)

- **The call.** `{ force, sessionId, term }`: the session and term the "Rebind anyway" offer was made on (`forceOfferOf`). A plain
  rebind sends `{ force: false }`, as today.
- **The parser (`shared/overlord-designation.ts#parseRebindBody`).** It takes the pair only whole. The session id must have a
  session's shape (`isSessionIdShape`) and the term must be a non-negative whole number; anything else is a 400, before the read.
- **The decider (`server/src/coord/overlordDesignation.ts#rebindMovedDetail`).** `null` while the binding stands. The detail of what is
  bound now and its term, or "nothing is bound", when it moved. `null` for a read that failed.
- **The door (`server/src/coord/overlordRoutes.ts`, by packet to its holder).** With a pair, the door asks the plain gate (`{ cap: null }`)
  and compares before it asks the step-up gate. It compares again on the serialiser, right after its own read.
- **The word.** `stale-designation` (409), the spec's word for a console call that names a designation that has moved (§4's chat
  send). The ruled proposal named a new word, and the refusal-table census reds a new Overlord word with no row in the spec's table.
- **The four holds:**
  1. A read that failed answers today's `unavailable`, never the word.
  2. A moved binding is refused before the step-up gate, so the operator is never asked to confirm an act that is then refused.
     Measured: with the step-up not fresh, a moved pair answers `stale-designation` after one plain-gate ask, and an equal pair
     answers `step-up-required`.
  3. The detail is the session bound now and its term, which the designation read already serves this caller.
  4. Past the compare, `rebind()` reads nothing of the pair: the stop and the create take the door's own read. A source scan pins it.
- **Every cause of `stale-designation` at this door (call 1685).** Before this change: none. The rebind door never answered the word,
  because it asks the account gate, not the Overlord's own gate, which answers it at the Overlord's write doors. After: the pair's
  compare alone, before the step-up and on the serialiser. A case pins that the same moved binding with no pair answers today's
  `overlord-attempt-pending`, and a source scan pins that both of the door's `stale-designation` lines are the compare's.
- **The console's sentence.** `REBIND_MOVED_TEXT` is keyed by the act (`OVERLORD_ACT_TEXT['stale-designation'].rebind`), as the
  sign-in-off sentences are. Every other act draws the word raw, and the place's word table does not carry it, so the chat's own
  sentence for the word, and any other screen's, is untouched.

## Departures

- **`settings-gains-an-overlord-section`** (the plan's own slug): a seventh section, last, drawn only under `overlord-v1`.
- **`independent-cards-draw-without-a-designation`.** The plan gates every card on the designation's read. The backstop, the retention
  and the account facts act on their own rows, so they are drawn in every state but `absent`. The account facts are what Start counts,
  so they must be settable before any Overlord exists. The three designation cards are gated as planned.
- **`step-up-sits-in-the-card-that-asked`.** One `ConfirmItsYou` for the section, drawn in the card whose act was refused, rather than
  at a fixed place on a long page.
- **`card-keeps-picks-until-the-door-answers`.** A card clears the operator's picks only on an answer, so the act pressed again after
  the step sends the same act.
- **`refusal-read-against-the-store-as-it-stands`.** A card words a refusal against the store at the moment the answer arrives. So a
  `not-found` after the designation read went unmeasured says the door did not answer, never "no designation row".
- **`account-set-card-keeps-the-saved-order`.** The boxes keep the saved order, and a newly ticked pool joins at the end. There is no
  reorder control here; a reorder is sent by Save again after a change elsewhere, or by a later piece.
- **`older-node-refusal-is-lane-act-refused-with-its-verb-code`** (above).
- **`retire-follows-its-doors-step-up`** (above).
- **`retention-read-answers-absent`** (above).
- **`settings-overlord-reads-its-own-rows`.** The frame's one view (`SettingsDataProvider`) does not read the backstop, the retention or
  the holds. Each card reads its own row once through `useCardRead`, kept as the store's five states by `nextReadState`. The
  designation stays the Overlord store's one read.
- **`hold-clear-sits-with-the-items-acts`** (ruled call 1684). The plan put the item's Clear after How; it sits in "Your move", after
  History.
- **`overlord-refusals-key-auth-off-by-gated-act`** (4a).
- **`strip-says-rank-changed-in-its-own-words`** (4c). This replaces home B's `rank-changed-says-the-table-sentence`.
- **`taking-effect-trusts-a-later-call`** (4d). This replaces home B's `taking-effect-trusts-only-a-newer-read`.
- **`place-label-read-inside-the-place`** (4b).
- **`forced-rebind-names-the-session-it-stops`** and **`rebind-moved-is-stale-designation`** (rulings 1675 and 1685).
- **`rebind-sentence-keyed-by-act`** (call 1685).

## Mutation rows

Each case was red with the mutant in place and green with it restored. The counts are measured; the commands ran one file at a time
through `ccrc test`.

- **The plan's three:**
  - **Task 8, the console asks the step-up for an `opus` save:** red in `settings-overlord` ("opus lands in one tap"), 1 of 25.
  - **Task 8, `not-found` before an answer (absent read as none):** red in `overlord-settings-words`, 3 of 41 (the gate's absent
    case, its absent-is-not-none case, and the status line's absent case), and in `settings-overlord`'s absent case, 1 of 25.
  - **Task 9, an absent `fableBilling` read as `credits`:** red in `overlord-settings-words` (1 of 41) and in
    `settings-account-facts` (1 of 11).
- **One per carried item:**
  - **4a, Pause's sign-in sentence put back:** red in `overlord-refusal-words`, 1 of 6.
  - **4b, the label read by `document.querySelector`, the old measure:** red in the place's browser file, 40 of 128 (every
    `bound` and `restartable` case in both skins, which read the Fleet's one-line form). This was measured as the "before" of
    the fix.
  - **4c, the strip says the table's sentence again:** red in `overlord-portfolio-strip`, 1 of 21.
  - **4d, a read at the door's own call number trusted (`>=`):** red in `overlord-words` (3 of 32), `overlord-ladder-part` (2 of
    26) and `overlord-readiness-part` (2 of 23).
- **The forced rebind's pair:**
  - **No compare before the step-up:** red in `overlord-rebind-route`, 3 of 49, hold 2's among them.
  - **No compare on the serialiser:** red, 2 of 49, the serialiser race among them.
  - **The compare on the session only:** red in `overlord-rebind` (1 of 36) and `overlord-rebind-route` (2 of 49).
  - **The stop takes the sent session (hold 4):** red only in the source scan of `rebind()`, 1 of 49. Under the compare the two are
    equal, so the behaviour cases cannot see it, which is why the scan exists.
- **The rest:**
  - **Clear's in-flight guard removed:** at first it SURVIVED, because the button turns disabled after the first tap. The cases
    now tap twice inside one render, where only the guard holds, and are red in `item-account-hold` and
    `settings-account-facts`, 1 of each.
  - **Clear drawn for a closed hold item:** red in `item-account-hold` (1 of 6) and `overlord-settings-words` (1 of 41).
  - **The older node's sentence dropped, and the roster not read again after a fact's answer, both in:** red in
    `settings-account-facts`, 4 of 11.
  - **The facts row widened to 520 px:** red in `settings-overlord`'s browser file, 24 of 40 (155 to 225 px sideways at the phone
    widths).

## What a merge arms

Nothing an operator sees, because no server advertises `overlord-v1` yet:

- the Overlord section, its index row and its "Go to" entry are drawn only under the word;
- a direct `/settings/overlord` draws Settings' index without it;
- the hold item's Clear is drawn only for an open Overlord hold item.

Each card writes only on the operator's tap. On the server, the rebind door changes only for a call that sends the pair, and only the
place's "Rebind anyway" sends it; a call without the pair behaves exactly as before. The place's carried items change what the place
says (4a, 4c), when "taking effect" ends (4d) and what its browser file measures (4b), all still behind the word.

## Harness dependence

None added. Every card is the console over the server's own doors, and the pair is a body field of the server's own rebind door. Any
agent harness the server hosts is served the same way (ruling 9).

## Known limits

- **A forced rebind that names no pair stops whatever is bound when it arrives.** Only an older console sends such a call. Nothing
  of the place is drawn without `overlord-v1`, so every server that will serve this console knows the pair.
- The account-set card has no reorder control (`account-set-card-keeps-the-saved-order`).
- `outcome-unknown` on a fact reads the roster again, but the roster mirror can lag the fleet box's file, so the re-read can still
  show the old fact for a while.
- The section's own reads (the backstop, the retention, the holds) are read once on mount and after a save, not polled.
