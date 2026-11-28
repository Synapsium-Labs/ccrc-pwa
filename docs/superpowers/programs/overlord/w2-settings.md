# Overlord W2 Settings: notes for the ledger

Run 4114 built `docs/superpowers/plans/2026-11-16-overlord-w2/w2-settings.md` (Tasks 1 to 3) and one carried ticket. That is the
decision model's host and rows, and the private-name list, in Settings › Overlord. It is one pull request, and it changes the
console only. This note says:

- what Step 0 measured and where `main` differed from the plan;
- what the build made;
- how the key and the list are carried;
- where the build departed from the plan;
- the mutation rows, and what is known to be left.

The plan was written before the section existed. Settings › Overlord was built by home C (#3489, note [`w1-home-c.md`](w1-home-c.md)),
and these cards are built on its owner, as the brief ruled (ruling 1). No deviation number was allocated, so each departure has a slug,
and the coordinator mints its number when it folds this note into the ledger.

## Step 0: each name, measured on `main` at `5576023f25`

| The plan's name | On `main` | What this build does with it |
|---|---|---|
| `DecisionModelView`, `DecisionRowView`, `readDecisionModelView` (SQ2) | In `shared/decisionModel.ts`, decision model B's | Imported; no type of its own. The server already pins the fixture through the type (`decision-model-routes.test.ts`, "answers a view that readDecisionModelView accepts…") |
| `DecisionRowSide` with `armedLine` | `{ mode, ceiling, armedLine: { id, line } \| null, held }`, numeric ids | Sent back as `expected` exactly as read |
| `host.endpoint` beside `origin` (F4) | In the read | The endpoint field is filled from it |
| `DECISION_MODEL_REFUSALS` | `shared/refusal.ts`, **eleven** words, not ten (`removed-not-held` is the eleventh) | One sentence each, typed over the shared list (ruling 5) |
| The held causes | `DECISION_HELD_CAUSES`, six: `drift`, `line-key`, `canary`, `bound`, `no-key`, `off-refused` | One sentence each (`DECISION_HELD_TEXT`), typed over the list |
| The key door's own `bad-request` | Fixed details, among them the masker's refusal ("the egress masker would not catch this key") | Its own sentence (`key-bad-request`), with the door's detail beside it |
| The doors' step-up | `decisionLines.ts#decisionStepUp`: arm and a key set always; off and a ceiling only when they widen; a key removal never | Not restated anywhere in the console (ruling 2) |
| `NAME_LIST_MODES` (SQ6) | Shipped by private names B in `shared/privateNames.ts`, with `NAME_LIST_ROW_REFUSALS`, `NAME_LIST_STATES`, `NAME_LIST_UNREADABLE` | SQ6's second spelling is void; nothing is added to `shared/` |
| The empty upload (F6) | `PUT /api/overlord/private-names` refuses `{ rows: [] }`, and takes an empty list only with `clear: true` | "Clear the list" sends `{ rows: [], clear: true }` (ruling 4) |
| A refused row | `bad-request` with `row` (its index) and `reason` (one of `NAME_LIST_ROW_REFUSALS`, six) | Each reason has a sentence, and the index is turned back into the line it came from |
| The eight doors' client calls | None on `main` | Eight calls in `pwa/src/lib/api.ts` (+18 net lines) |
| Home C's section | One `useStepUp` (`ASSUME_FRESH`), one `ConfirmItsYou` drawn in the card that asked, `useCardDoor`, `useCardRead`, `DoorLines`, the per-act refusal table, `SETTINGS_CARDS.overlord` | The new cards use all of them (ruling 1) |

Where `main` differed from the plan, and what followed:

- **Nothing in `shared/` was needed.** Both of SQ2's and SQ6's fallbacks are void: decision model B and private names B shipped the
  types and the lists.
- **A row the console does not know is not drawn as "unknown to this console" (SQ3).** The shared reader refuses the whole view on an
  unknown row id or a mode outside the three, so the card says the read could not be read. The code on `main` rules (slug
  `unknown-row-refuses-the-read`, Known limits). The plan's mutant W3 has nothing to mutate.
- **The plan's caps checks are the door's.** The brief rules that the console does not rebuild the door's parsing (ruling 4), so the
  console checks neither the row cap nor the characters cap. The door answers each with its row and reason, or with a detail for the
  row cap. The plan's mutant W2 has nothing to mutate (slug `name-list-caps-are-the-doors`).
- **The door refuses a key the egress masker would not catch** (review 2431 L3). A key under the masker's floor is never stored any
  more, so the read's `masked: false` comes only from a key stored before that rule. The short-key line is still drawn for it (F13).
- **`auth-off` is the door's answer, not a disabled control (SQ9).** The console does not read the sign-in state to grey a control,
  because that would be a second decider. A write while sign-in is dark draws the act's `auth-off` sentence (slug
  `auth-off-is-the-doors-answer`).

## What was built

- **The words (L1).**
  - `pwa/src/overlord/decisionModelWords.ts`: the read through the shared reader, each row's line (`decisionRowLine`), the mode,
    held-cause and host-kind labels, and each door's answer read (`rowAnswerOf`, "Held, not off" for ruling F1). Also the ceiling
    field's reader (`ceilingOf`: a whole number or nothing; the bounds are the door's).
  - `pwa/src/overlord/nameListWords.ts`: the status read, the three status sentences and five unreadable reasons, the text into
    rows (`nameListRowsOf`), the six row reasons and the refused row's line (`nameListRefusalText`).
- **The sentences (`pwa/src/lib/refusalWords.ts`).** The section's act table gains four acts:
  - `decision-row`: arm, off, Resume, Approve and the ceiling;
  - `decision-key` and `decision-key-remove`;
  - `name-list`, Clear the list included.

  `DECISION_MODEL_REFUSAL_TEXT` is typed over the eleven shared words. The key door's and the list's `bad-request`, `auth-off` by
  act, `slot-busy`, `oversize`, and the journal's two words each have a sentence.
- **The calls (`pwa/src/lib/api.ts`, +18 net).**
  - `decisionModel`, `armDecisionRow`, `offDecisionRow`, `setDecisionCeiling`, `setDecisionKey`, `removeDecisionKey`,
    `privateNameList` and `uploadPrivateNames`.
  - Each answer is `unknown`. A 2xx whose body is not JSON is `'unreadable'`, never a refusal.
  - Resume and Approve reuse `armDecisionRow`, and Clear reuses `uploadPrivateNames`.
  - The block sits after `poolRunway`, not after `clearAccountHold`. That is where #3488 adds the chat's calls, so the merge keeps
    both sides without a conflict.
- **The cards (L4, context K).**
  - `DecisionModelCard.tsx`: one read of `GET /api/decision-model` for two cards, the host card and then the rows card. Each row has:
    - its question (the catalogue's own text);
    - advice or gate, and the private-state line;
    - the three-state radio set, whose checked choice is the stored mode;
    - held with its cause, and Resume;
    - today's calls of its ceiling, the line and its canary, the gate's own line, and Approve for an offered line;
    - the ceiling field with its Save.
  - `DecisionHostCard.tsx`: the kind, the endpoint and the model id from the read, and the key field. Save sends the key only when
    one is typed. Remove asks first. A hosted kind shows the paid-and-provider line, which names no provider.
  - `PrivateNamesCard.tsx`: the status sentence, the box, Upload, and Clear the list (only while a list is stored, after a confirm).
  - Each card is drawn like the backstop and the retention (ruling 3): no card on a 404, the read's sentence and Read again on a
    failure, and its own sentence on an empty answer ("no rows", or a list never uploaded).
- **The section's owner, extended (ruling 1, slug `settings-owner-gains-a-note-row-and-a-field`).** `overlordCards.tsx` now exports
  `ReadLine` and `valueOf`. It also gains `NoteRow` (a note and the controls that act on it: Read again, Resume, Approve) and
  `CardField` (a labelled field), so the markup census sees one shape where my cards would have written a second. `ReadLine` draws
  through `NoteRow`.
- **The titles table.** `SETTINGS_CARDS.overlord` gains `decisionHost`, `decisionRows` and `privateNames`, and
  `settings-frame.test.tsx`'s page case lists the new titles.
- **The carried ticket (`clear-answer-after-its-control-unmounted`).** `AccountHoldClear` gains `onSent`, and the account's row latches
  its hold block when the Clear is **sent**, not when it is answered. Another row's re-read that drops this lane's hold now leaves
  the same control mounted, busy, and its answer is drawn there. A refusal drops the latch again, as before. Pinned by
  `settings-account-facts`' new case: two Clears in flight, the other's answer and re-read first. The other Clear cases are
  unchanged and green.
- **The routes comment.** `pwa/src/lib/routes.ts` said "six section pages"; it says seven. The other "six" in the tree describe what
  their own cases render without `overlord-v1` (`command-layer.test.tsx`'s nine "Go to Settings" options,
  `settings-frame.test.tsx`'s scope census list), so they are correct as they stand.

## How the key and the list are carried (ruling 6, ruled call 1815)

The brief named two places, and they were two mechanisms. The item secret panel on Waiting on you keeps its value in component
state. The accounts' secret field keeps it only in its own DOM node, but empties it on its one read. Neither carried a value across a
step-up without state, and neither had a multiline form. The coordinator ruled to extend the second, with four conditions:

- **One mechanism, extended.** `pwa/src/accounts/SecretField.tsx` gains `peek()`, a read that does not empty, and `multiline`, an
  uncontrolled, unmasked text area with no Show control. The text area carries the same attributes and is emptied by the same page
  hide and route change.
  - The connect and replace sheets still read with `take()`, and their behaviour is pinned first, green on `main`, by
    `secret-field-sheets.test.tsx` (the first commit, condition 1).
  - Their own suites are untouched and green.
- **The key.**
  - Save's request reads the field with `peek()` inside the request itself, so the key lives in the request and nowhere else, the
    heap included (review 4167 F1, ruled call 1930). No local of the send holds it, and Save's retry is made outside the send
    (`saveRetry`, from one boolean), so the closure the section keeps while the step shows can reach no key. The shape is held by
    source, in `settings-retry-census.test.ts`, because no runtime check sees what a closure captures (below).
  - The field is emptied on the door's answer and on every refusal, never on a first `step-up-required`, so the retry sends the
    same key once more.
  - The retry is the send the confirm starts (review 4139 F1, ruled call 1876; below). Its own `step-up-required` is final: it is
    worded for what was refused (`DECISION_WORDS.stepUpFinal` with a key, `stepUpFinalHost` for the host alone, A4) and the field is
    emptied (condition 4).
  - The retry never sends less than the first send carried (F2). Save keeps one boolean, whether a key was typed, never the key. A
    retry that finds the field emptied sends nothing and says so (`DECISION_WORDS.keyGone`). Held from the press (below), the
    field is emptied only by its own rule: a page hide, or a route change that keeps it mounted. The sentence names the page hide;
    after such a route change it names the wrong cause, a wording limit only, since nothing is sent (review 4183 F5). A Save that
    carried no key retries with none.
- **The names.**
  - Upload reads the box with `peek()`, checks that the text parses, and sends. The rows are built inside the request
    (`rowsBodyOf`), so they live in the request body and nowhere else, the heap included (F1), and only the line numbers they came
    from are kept, to word a refused row. The check and the request run in one task with no await between, so the request sees the
    text the check saw; text that no longer parses there is refused before anything is sent, never an emptier upload.
  - The box keeps the names only where the operator must edit or confirm them (A2, `names-kept-only-to-be-edited`): a refused row,
    a refused cap (the row count's `bad-request`, and `oversize`) and a first step-up. The rule reads the words, so the one server
    fault that also answers `bad-request` with no row (a row it could not hash, which the console's own body cannot cause) keeps
    them too (review 4167's residual under C7). The door's answer, a 401 (the person at the screen is no longer proven) and every
    other refusal empty it. The field's header, the card's and the rule's say so.
  - The retry reads the box again; one that finds it emptied (held, only the box's own rule empties it: a page hide, or a route
    change that keeps it mounted, the same wording limit as the key's) sends nothing and says so (`NAME_LIST_WORDS.namesGone`). Its own step-up is final and worded for its act: Upload's or Clear's (`clearFinal`).
- **The confirm starts the retry** (F1). The section keeps the one retry a card hands with its `step-up-required`, and sends it when
  the confirm lands, once. A press by the operator is always a first send; only the confirm's send is a retry. The mark is per act
  (Upload and Clear hand their own), so a retry's answer is worded for its act. Each retry is made at the card's own level,
  outside every send (`saveRetry`, `uploadRetry`, `clearRetry`), so it can reach no value a send read (review 4167 F1). Any other
  `ask`, another card's answer included, drops a retry not yet sent. `useStepUp` still retries nothing; the section owns this
  (`SectionCtx.ask`, `held`).
- **The card is held from the press to the end of its step** (review 4167 F2 and F3, ruled call 1930; review 4183 F1, ruled call
  1956; slug `card-held-whole-while-its-step-shows`). The controls that type or send are disabled: the host's kind, endpoint and
  model id, the key field, Save and Remove; the names box, Upload and Clear. The send in flight holds them from the press to its
  answer (`busy`, the two fields included since review 4183 F1), and the section holds them while the step shows (`held`); each
  field takes `busy || held`, as the other controls always did. The controls that send nothing are not held: the key field's Show
  toggle and the read's Read again. So a key typed between the press and the confirm is never discarded, an edited key is never
  sent as "the same key", the box never uploads fewer rows than the first send carried, and no other act of the card can be in
  flight when the confirm lands. The secret field carries the hold as an additive `held` prop: absent, it is as before, and the
  account sheets pass none.
  - What puts the step away, and so frees the card (measured by review 4183 from the hook): the confirm, which sends the retry
    first; another card's answered act (a decision row's Off, for one); another card's `step-up-required`; leaving Settings; a
    sign-out and in; a reload. Another card's other refusals do not. Then the next press is a first send.
  - A known limit (review 4183 F2): the hold is by card, so a Save's step holds the key's Remove too, which is a narrowing that never
    asks the step. Where the step cannot be confirmed on this device (locked, or unavailable with no retry), the step draws no
    button and no cancel, and Remove stays held until one of the exits above. This is reconciled with the plan's Table 1 ("Off
    from a phone in an emergency stays one tap") thus: the decision rows' Off sits on the rows card, which the hold never touches,
    and the door side is unchanged, so Remove still asks no step. Holding Remove is the ruling of call 1930: it stops the
    confirm's Save retry racing a Remove in flight. No case covers a locked step with the host card held.
  - The hold is by attribute, and no path reaches a handler while it stands. A disabled button gets no click, and the cards have
    no form, no submit and no key handler. The two fields' only handler is their presence report (`onInput`), which sends nothing,
    and a browser delivers no keystroke to a disabled field. So the cases that click a held control check the attribute and that
    nothing was sent, and that is the whole of the path (the reviewer's remark on case 16).
  - The retry's in-flight guard is unreachable for a retry, and the cases show the preconditions. The asking door clears its own
    in-flight mark before the step is drawn (`useCardDoor` sets it in `finally`, right after the `ask`). While the step shows,
    nothing of the card can start a send (every control that sends is held), and the names card's two acts share one door. The
    cases assert that, while Upload's or Clear's step shows, the other act is held and the door is idle (Upload's label is not
    the in-flight one, in both cases since review 4183 F4), and that the confirm's retry is sent.
  - The decision rows and home C's cards hand no retry, so they keep their old shape: the operator presses again after the confirm,
    and nothing is held but the press in flight.
- **Where neither is, measured.** The cases check that neither value is ever in:
  - the markup;
  - a `console` call;
  - the overlord or fleet store;
  - browser storage;
  - a refusal line;
  - a React fiber's props or state.

  The last is a walk of every fiber's props and hook state, with its own control case. Since fix round 1 (A1) it runs for the key as
  well as the names, after typing, with the step showing, and after the retry and its answer. It is one helper since fix round 2
  (`pwa/test/helpers/fiberWalk.ts`, F5). **What it cannot see** (F6): it skips functions, so a value kept only in a closure's scope
  is invisible to it. The reviewer's mutant that kept the typed key in the retry's closure left every case green. So the source is
  checked instead: `settings-retry-census.test.ts` reads the two card files. The fact it guards is that no value stands in a
  send's scope, the scope a retry would otherwise be made in; it checks lines of text, and is no proof about closures (review
  4183 F3). It requires:
  - every `send: () =>` line to be a maker at the component's level, of the two shapes it names, whose name is its act;
  - each door call to hand the maker's retry by name (a `toContain`, which a comment of the same text would also satisfy);
  - the requests to read their fields inside themselves: the key's `peek` in the request, and Upload's body built from the box in
    the request (`rowsBodyOf(text.current)`), so the rows kept in a local of any name are red (since review 4183 F3; M41);
  - no local named `typed` or `body`.

  It cannot see: a component-level `let` assigned inside a send; a retry written as `send: async () =>`, in method shorthand or
  split over lines; a cast that passes a string as `carried`; a value kept by another means than a local of the send. The code
  holds none of these today, and the census is not grown into a parser. Fixtures use a synthetic key and synthetic names only.
- **Not mine (c).** The item secret panel (`pwa/src/ledgers/ItemView.tsx`'s `SecretPanel`) still keeps its value in component state.
  It is on the coordinator's ticket `item-secret-panel-holds-its-value-in-state`.

## Departures (slugs)

- `settings-step-up-follows-the-door` (the plan's own): every write goes through the section's one `useStepUp`, mounted with
  `ASSUME_FRESH`, and the console reads no direction. The cases run the same moves against a door that asks and a door that passes.
- `decision-model-view-in-shared` (the plan's own): the types are decision model B's; nothing is added.
- `name-list-modes-shipped-by-private-names-b`: SQ6's second spelling is void.
- `unknown-row-refuses-the-read` (above).
- `name-list-caps-are-the-doors` (above).
- `auth-off-is-the-doors-answer` (above).
- `one-read-for-the-decision-model`: the host card and the rows card draw one read, not a hook each (ruling 1: no second view hook).
  The read's loading and failure line is drawn once, in the host card, and the rows card is drawn once the read has a view.
- `the-key-and-the-list-ride-the-secret-field` (ruling 6, call 1815; above).
- `the-confirm-starts-the-retry` (review 4139 F1, ruled call 1876; it replaces `step-up-retry-is-the-operators-press`): condition
  4's retry is the send the section starts when the confirm lands, for the key's Save, Upload and Clear the list; a press is always
  a first send.
- `rows-keep-the-press-after-the-confirm`: the decision rows hand no retry. They carry no value a field could lose, so they keep the
  section's doctrine, as home C's cards do: the operator presses the move again after the confirm. Their table runs every move in
  both arms (A9), the armed gate switched off among them since fix round 2 (review 4167 F4): Table 1's one widening off.
- `card-held-whole-while-its-step-shows` (review 4167 F2, F3, ruled call 1930; review 4183 F1, F2, F5): above. The hold is by
  card, whichever of its acts asked (Remove's own step holds the card too): from the press its send in flight holds every control
  of the card that types or sends, and while its step shows the section holds them, until one of the exits above. A narrowing is
  held with it (Remove), which is the known limit above.
- `retry-made-outside-every-send` (review 4167 F1): above. The retry's maker can reach no value; a source census holds the shape.
- `retry-never-sends-less` (F2): one boolean per Save, never the value; an emptied field on the retry sends nothing.
- `names-kept-only-to-be-edited` (A2): above, and in the field's header.
- `empty-list-is-its-own-state` (A3): a list read back with no names (after a Clear; the door stores its check alone) says so, draws
  no count and offers no Clear. Its sentence is true of what the relay still does: it checks that the list reads and matches no name.
- `row-answer-installed-then-read-again` (A5, the plan's SQ4): a row door's answer installs its side and its held cause into the card
  read (`useCardRead`'s `patch`, `withRowAnswer`), then the card reads again, so a re-read that fails still shows the stored mode.
- `unreadable-view-offers-reload` (F4): an answer the shared reader refuses keeps the reader's own detail (`useCardRead`'s
  `detailOf`), and the line says the console may be older than its server and offers Reload, not a Read again that cannot cure it.
- `absent-decision-model-draws-no-card` (F4): a server without the read (its 404, the card read's `absent`) draws neither decision
  card, as the backstop and the retention do.
- `w2-cards-measured-in-the-section-browser-file` (A6; the brief's ruling 7): the W2 cards are measured in the section's own browser
  file at its widths, skins and palettes, with a fourth state, `w2-refused`, that draws a refused row's line (the longest row
  sentence) and measures it inside the page.
- `same-mode-guard-removed`: a row's "the picked mode is the stored one" guard was dead, because a native radio fires no change for
  its own checked choice, so no mutant could kill it. It is removed, and the case "the checked radio calls nothing" still holds.
- `mode-words-typed-over-the-modes` (A7): the mode words are a record over `NAME_LIST_MODES`, and the three sentences that name the
  modes are built from it, so a new mode is a type error.
- `settings-owner-gains-a-note-row-and-a-field` (above).
- `clear-latches-at-send` (the carried ticket, above).
- `held-off-row-draws-no-resume`: Resume is the arm door with the stored mode, and the arm door takes `shadow` or `armed` only, so a
  held row whose mode is `off` draws its hold sentence and no Resume.
- `one-refusal-act-for-a-rows-moves`: the plan's ceiling door and the row moves share the act `decision-row`; their words do not
  differ.
- `row-refusal-named-by-its-row-and-reason`: a refused row is recognised by its row index and a reason from the door's closed list,
  which only the upload's row refusal carries, not by comparing the word to a literal (the refusal-branch ratchet stays at 32).
- `list-controls-wait-for-the-status`: the list's box and Upload are drawn once the status is read, as every card with its own read.
- `textarea-in-the-control-census`: the secret field's text area joins the control census (TOKEN, `.acct-secret-text`, two floors
  tall) and the tap-target suite, by packets their holders accepted. The section's other new controls are `@ccrc/ui`'s.

## Mutation rows

Each mutant was put in, seen red, and taken out. Counts are measured, one file at a time through `ccrc test`.

**The words modules, in the floors suite** (`server/test/sim/homeSets.ts`). There are two new sets: N1 to N5 on
`nameListWords.ts#nameListRowsOf`, and DW1 to DW5 on `decisionModelWords.ts#decisionRowLine`. Each mutant is killed by the set's
oracle cases, and the baseline passes unmutated. DW3 (an armed gate's line drawn only with an offer) survived the first suite; the
case of an armed gate with no offer now kills it. The floors file is held by another run; its two floors (1 each) went to the holder
as a packet, which it accepted, and were applied exactly.

| Id | Mutant | Before (mutant in) | After |
|---|---|---|---|
| N1 | a line with no mode read as `exact` (the plan's W1) | killed | green |
| N2 | empty text answers zero rows (the plan's W4) | killed | green |
| N3 | blank lines not skipped | killed | green |
| N4 | an unknown mode word accepted | killed | green |
| N5 | a refused row's index read as its line | killed | green |
| DW1 | every row drawn held | killed | green |
| DW2 | today's calls of the row's own count, not its ceiling | killed | green |
| DW3 | the gate's line drawn only with an offer | killed (after the case was added) | green |
| DW4 | `offRefused` ignored | killed | green |
| DW5 | the ceiling field takes a decimal | killed | green |
| N6 | fix round 1 (A2): a 401 keeps the names | killed | green |
| N7 | fix round 1 (A2): a refused row's and a refused cap's words empty the names | killed | green |
| N8 | fix round 1 (A2): every word keeps the names | killed | green |
| DW6 | fix round 1 (A5): a row's answer installed in every row | killed | green |
| DW7 | fix round 1 (A5): an answer that names no cause read as "not held" | killed | green |
| DW8 | fix round 1 (A5): the answer's side not installed | killed | green |

In fix round 1, N1's target moved with the default mode's name (`DEFAULT_MODE`), and a planned N7 on a separate row clause in
`nameListKeepsText` was dropped with that clause: a refused row is always a `bad-request`, which the keep words already hold, so the
clause was dead.

**The console, by hand** (the brief's rules, the plan's Task 2 and Task 3 steps, and the coordinator's condition 2):

| Id | Mutant | Red with it in | Green after |
|---|---|---|---|
| M1 | condition 2a: `peek` empties the field, so the retry after the step-up sends nothing | `settings-decision-model` 3 of 49, `settings-private-names` 8 of 21, `secret-field-forms` 4 of 11 | yes |
| M2 | condition 2b: the field not emptied on the door's answer (the key's Save; then the list's Upload) | `settings-decision-model` 3 of 49; `settings-private-names` 2 of 21 | yes |
| M3 | condition 2c: the field survives a page hide | `secret-field-forms` 2 of 11, `settings-private-names` 1 of 21, `secret-field-sheets` 1 of 10 | yes |
| M4 | condition 2d: the multiline form mirrors its text into component state | `settings-private-names` 1 of 21 (the fiber walk) | yes |
| M5 | a send goes once: the card door's in-flight guard removed | `settings-decision-model` 1 of 49, `settings-private-names` 1 of 21 | yes |
| M6 | the console asks the step-up itself before an off | `settings-decision-model` 5 of 49 | yes |
| M7 | the radio set checks the tapped choice before the door answers | `settings-decision-model` 3 of 49 | yes |
| M8 | a row's ceiling drawn as a default (600), not as read | `settings-decision-model` 2 of 49 | yes |
| M9 | condition 4: a second step-up on the retry is not final (the key stays) | `settings-decision-model` 1 of 49 | yes |
| M10 | the endpoint filled from `origin`, not `endpoint` (F4) | `settings-decision-model` 2 of 49 | yes |
| M11 | Resume dropped (F10) | `settings-decision-model` 2 of 49 | yes |
| M12 | ruling 4: empty text sends an empty upload | `settings-private-names` 1 of 21 | yes |
| M13 | ruling 6: the parsed rows logged on a refused upload | `settings-private-names` 1 of 21 | yes |
| M14 | the carried ticket: the latch set on the answer only, not at the send | `settings-account-facts` 1 of 15 | yes |
| M15 | ruling 5: one of the eleven words loses its sentence (its compile error cast away) | `decision-model-words` 1 of 29 | yes |

**Fix round 1, by hand** (review 4139, ruled call 1876). The counts are of the round's files: `settings-decision-model` (67) and
`settings-private-names` (30). A file not listed was not run for that mutant.

| Id | Mutant | Red with it in | Green after |
|---|---|---|---|
| M16 | F1: the confirm never sends the retry | `settings-decision-model` 8 of 67, `settings-private-names` 7 of 30 | yes |
| M17 | F1 (b): the control that asked not held while its step shows | `settings-decision-model` 3 of 67, `settings-private-names` 2 of 30 | yes |
| M18 | F1 (c): the mark not per act (Clear held by Upload's step) | `settings-private-names` 1 of 30 | yes |
| M19 | F1 (d): another `ask` does not drop the retry | first: survived (`settings-private-names` 0 of 30, and the 1 of 67 was a load red in a row case no retry reaches); with the added case: `settings-decision-model` 1 of 68 | yes |
| M20 | F1: the retry's own step-up not final | `settings-decision-model` 2 of 67 | yes |
| M21 | F2: a retry whose key field was emptied sends anyway | `settings-decision-model` 1 of 67 | yes |
| M22 | F2: the names' emptied retry worded as an empty box | `settings-private-names` 1 of 30 | yes |
| M23 | F3: `bad-ceiling` without the door's range | `settings-decision-model` 1 of 67 | yes |
| M24 | F4: an unreadable answer loses its detail (no Reload) | `settings-decision-model` 3 of 67 | yes |
| M25 | A2: every refusal keeps the names, a 401 included | `settings-private-names` 4 of 30 | yes |
| M26 | A3: Clear offered on an empty list | `settings-private-names` 1 of 30 | yes |
| M27 | A4: Clear's final worded as Upload's | `settings-private-names` 1 of 30 | yes |
| M28 | A5: the row's answer not installed | `settings-decision-model` 2 of 67 | yes |
| M29 | A1: the key mirrored into component state | `settings-decision-model` 1 of 67 (the fiber walk) | yes |

M19 survived its first run. In the names file the press after another card's answer hands a new retry, which replaces one left in
place, so that file cannot see it. Its one red in the decision file was a row's step-up case, where no retry is ever handed; that
case passed on the rerun, so the red was the box's load. The added case kills it: Save's step shows, Remove the key is then answered
`step-up-required` (an act that hands no retry), and the confirm must send no Save. Red with M19 in (1 of 68, that case alone),
green without it. The other counts above are of 67, before that case was added.

M13 survived its first form, which logged inside the answer's words reader: that reader runs only on an answer, and a second send
was stopped by the in-flight guard, so the mutant could never log on a refusal. The plan's mutant, a log in the refusal path, is the
row above, and it is red. Two of the plan's Task 2 mutants have no target here: "prefill the key field" (the field is uncontrolled and
takes no value), and "draw an unknown row with a control" (the shared reader refuses the view). "Mount `useStepUp` with `null`" is
home C's section, unchanged; its mount case is `settings-decision-model`'s "no step on mount". "Nothing a running session sees changes
at merge" is held by the section's `overlord-v1` cases in `settings-frame` and by `secret-field-sheets` for the account sheets.

**Fix round 2, by hand** (review 4167, ruled call 1930). Applied on a throwaway copy of `pwa/` in the session's temp root, never the
checkout: each file's baseline green first, the mutant in, the reds counted, the file restored. The counts are of the round's files:
`settings-decision-model` (71), `settings-private-names` (31), `settings-retry-census` (9) and `secret-field-forms` (17). The
review could not re-run the round-1 rows below, so they are measured again here, on this round's code. M17 to M19 are re-aimed at the
section's whole-card hold, which replaced the per-act one.

| Id | Mutant | Red with it in | Green after |
|---|---|---|---|
| M30 | F1: the reviewer's mutant, Save's retry arrow written again inside the send (the source rule broken; at this tip the send's scope holds no key, so the runtime files' 0 shows nothing about the walk, and the census is the check) | `settings-retry-census` 4 of 9; `settings-decision-model` 0 of 71 | yes |
| M31 | F1: the names' body built in a local named `body` of Upload (a source-rule violation the census catches, not a leak while the step shows) | `settings-retry-census` 1 of 9; `settings-private-names` 0 of 31 | yes |
| M32 | F2: the key field not held | `settings-decision-model` 3 of 71 | yes |
| M33 | F2: Remove not held | `settings-decision-model` 4 of 71 | yes |
| M34 | F2: the names box not held | `settings-private-names` 3 of 31 | yes |
| M35 | F3: Clear not held while Upload's step shows | `settings-private-names` 2 of 31 | yes |
| M36 | F2: the secret field ignores `held` | `secret-field-forms` 2 of 17, `settings-decision-model` 3 of 71, `settings-private-names` 3 of 31 | yes |
| M37 | F2: another card's answer does not free the card (held while any step shows) | `settings-decision-model` 2 of 71, `settings-private-names` 1 of 31 | yes |
| M38 | F4: an armed gate switched off sent through the arm door | `settings-decision-model` 2 of 71 | yes |
| M17 | (again) nothing held while the step shows | `settings-decision-model` 4 of 71, `settings-private-names` 3 of 31 | yes |
| M18 | (again, re-aimed) the mark not per act: Clear's step hands Upload's retry | `settings-private-names` 2 of 31 | yes |
| M19 | (again) another `ask` does not drop the retry | `settings-decision-model` 1 of 71 (case 18) | yes |
| M22 | (again) the names' emptied retry worded as an empty box | `settings-private-names` 1 of 31 | yes |
| M23 | (again) `bad-ceiling` without the door's range | `settings-decision-model` 1 of 71 | yes |
| M24 | (again) an unreadable answer loses its detail (no Reload) | `settings-decision-model` 3 of 71 | yes |
| M26 | (again) Clear offered on an empty list | `settings-private-names` 1 of 31 | yes |
| M27 | (again) Clear's final worded as Upload's | `settings-private-names` 1 of 31 | yes |
| M28 | (again) the row's answer not installed | `settings-decision-model` 2 of 71 | yes |

The floors suite's rows N6 to N8 and DW6 to DW8 were run again in this round, on its code: the two sets
(`nameListRowsOf`, `decisionRowLine`) pass with every mutant killed, beside the baseline and the keys check (4 of 4, run with the
suite filtered to them).

**Fix round 3, by hand** (review 4183, ruled call 1956). The same copy and method, on this round's files:
`settings-decision-model` (72), `settings-private-names` (32) and `settings-retry-census` (10). "Before" is the reds of the round's
first commit, the cases on round 2's code, which is the mutant's code exactly.

| Id | Mutant | Before (round 2's code) | Red with it in | Green after |
|---|---|---|---|---|
| M39 | F1: the key field not held while its Save is in flight (`held` only, not `busy \|\| held`) | `settings-decision-model` 2 of 72 red (cases 15 and 16) | `settings-decision-model` 2 of 72 | yes |
| M40 | F1: the names box not held while Upload is in flight | `settings-private-names` 1 of 32 red | `settings-private-names` 1 of 32 | yes |
| M41 | F3: Upload's rows kept in a local the name rule does not know (`rowsNow`) | round 2's census green, 9 of 9 (measured by review 4183) | `settings-retry-census` 2 of 10; `settings-private-names` 0 of 32 | yes |

M19 and case 18: Remove is held while Save's step shows now, so round 1's order (Remove asked after Save) cannot be pressed.
Case 18 now drops Save's retry through a row's step, which is another card's ask. That order alone cannot kill M19, because the
section sends a retry only from the card that asked last. So the case goes on: once the row's step is confirmed, Remove's own step
in the host card is confirmed too, and no Save may follow. With M19 in, the kept retry is sent there, 1 of 71.

## Fix round 1 and the one merge of main (review 4139, ruled call 1876)

The round is three commits on the reviewed tip `af6b399fdd`: the red cases first, then the build, then this note and the case that
kills M19. Then the branch took one merge of main, on the coordinator's go once #3488 had landed, never a rebase.

- **Which main:** `07e8cc51e1`, the chat PR #3488's merge; `origin/main` read that sha at the fetch.
- **Hand resolutions:** none. The probe was clean (exit 0) and git merged every file.
- **Files both sides touched, merged by git and read:**
  - `pwa/src/lib/api.ts`. Main added the chat's import block, its `readAnswer` funnel and its three calls after
    `clearAccountHold`. This branch's eight calls sit after `poolRunway`. Both are kept, and this branch adds 18 lines over main.
  - `server/test/sim/mutation-floors.json`. Main added fifteen chat floors and this branch two (the two words modules). Both are
    kept.
- **The figures, measured on the merged tree:**
  - The gate's count lines are main's: 345 scanned, 342 HTTP, 222 gated and 120 exempt, over 34 route files. The merged branch
    changes no `server/src` and no `shared/` file against main, so it adds no route. The gate suite's pin of 345, the box-token
    census and the other lanes' census all pass (584 cases).
  - The console's type check is clean, and the growth check passes.
  - The floors: this branch's two sets and every set main brought are killed (17 sets).
  - The section's browser file passes 80 of 80, in four states.
  - The console's whole suite passed 677 of 682 files. The other five were killed by the test slice's shared memory cap (nine
    kills): `fonts-built`, `reader-built` and `review-built` (each a production build) and `mockup-policy` and
    `wrap-screen-golden`. Each passes alone: 8, 9, 12, 153 and 1185 cases.
- **The full run on the pushed tip `c5f3e03f2d` was red in one case of this branch's own (ruled call 1918):** case 4's raised
  ceiling, in `pwa/test/settings-decision-model.test.tsx`, asked for the step's Passphrase field at once, while the step was
  still drawn loading (`data-step-up="loading"`). The race was in the case from the first build. The case now waits for the
  field (`findByLabelText`), a one-line commit; the file passes 68 of 68 alone, three runs in a row. Every other job of that
  run was green, the four browser shards among them.

## Fix round 2 (review 4167, ruled call 1930)

Review 4167 read `28b233b966`. The round is three commits on it: the red cases first, then the fix, then this note together with
case 18's tail, which alone kills M19 (above). Nothing in
`server`, `shared` or `ccd`; no door is sent anything new in the ruled orders; no new refusal word.

- **F1, the retry holds no value.** The retries are made by makers at each card's own level (`saveRetry`, `uploadRetry`,
  `clearRetry`), and the requests read their fields themselves: the key's `peek` inside the request, the names' body built inside
  it (`rowsBodyOf`). The check is by source, because no runtime check sees a closure: `pwa/test/settings-retry-census.test.ts`, 9
  cases over the two card files. It goes red on the reviewer's mutant (M30, 4 of 9) and on a body kept in a local (M31), where every
  runtime case stays green.
- **F2 and F3, one rule.** While a card's step shows, that card is held whole (`SectionCtx.held`, which replaces `stepShows`). The
  secret field gains `held`, additive: the account sheets pass none, and their characterization is untouched and green (10 of 10).
  The cases: the key field, Remove and Save held through a key Save's step; the key field held through a host-only Save's step;
  Clear held through Upload's step and Upload and the box through Clear's; everything freed by another card's answer, with the next
  press a first send (Clear's freeing checked since review 4183 F4). The two emptied-field sentences stay as worded; review 4183
  F5 found the second cause, a route change that keeps the field mounted, stated above. The in-flight guard is unreachable for a
  retry, as argued above, and the cases show its preconditions. Round 2's hold began only when the step showed; review 4183 F1
  found the window before it, closed in fix round 3 (below).
- **F4.** The move table gains the armed gate switched off (`readback.omits`, Off); it passes on the code, which already sent it
  through the off door, and M38 shows it can go red.
- **F5.** One fiber walk, `pwa/test/helpers/fiberWalk.ts`, imported by both settings files.
- **F6.** The note, the helper's header and both files' comments say what the walk cannot see and point at the census.
- **The remark on case 16.** Above: the hold is by attribute, and no path reaches a handler while it stands.
- **C7's residual wording.** Corrected in this note, the card's header, the secret field's header and the keep rule's own comment
  (`nameListWords.ts`): the one server fault that answers `bad-request` with no row keeps the names too.
- **The changed assertions, and why.** Case 15 asserted Remove enabled during Save's step; the ruling holds it, so the case asserts
  the whole card held. Case 18 pressed Remove during Save's step, which the hold forbids; it drops the retry through a row's step
  now and goes on to Remove's own step (above). The names file's per-act case pressed Clear during Upload's step; it is two cases
  now, one hold in each direction, with Clear's own body retried. Nothing else was loosened.
- **Verified**, each file alone through the fleet test wrapper, two workers at most:
  - `settings-decision-model` 71 and `settings-private-names` 31;
  - `secret-field` 3, `secret-field-forms` 17 and `secret-field-sheets` 10;
  - `confirm-its-you` 34;
  - `settings-overlord` 28, `settings-account-facts` 15 and `settings-frame` 33;
  - `overlord-chat` 33, `overlord-chat-words` 29 and `overlord-chat-part` 2;
  - `control-census` 13 and `tap-targets` 101;
  - `contrast` 376, `theme-catalogue` 20, `theme-bridge` 14 and `focus-ring` 11;
  - `refusal-literal-ratchet` 2, `decision-model-words` 34 and `name-list-words` 37;
  - `settings-retry-census` 9;
  - the section's browser file, 80 of 80;
  - the console's rings, `pwa-rings` 10 and `pwa-one-owner` 42;
  - the floors' keys for this branch's two sets (4 of 4, filtered);
  - `growth-check` 63 (3 skipped) and `growth-caps` 12;
  - the console's type check, clean.

  The control census and the browser file draw no state with a step showing, so they see no held control. Their rows are
  unchanged, because nothing they measure changed.

## Fix round 3 (review 4183, ruled call 1956)

Review 4183 read `08dddcebd3` and found round 2's F1 closed in fact. The round is three commits on it: the red cases first, then the
fix with the headers, then this note. Nothing in `server`, `shared` or `ccd`; no door call, word or retry maker changes.

- **F1, the window before the step.** The hold began only when the step showed, so between the press and the first send's answer
  the key field and the names box stayed editable while every other control of the card was held by the send in flight, and the
  retry read the field again (the reviewer's measure: two rows sent first, one on the retry). The two fields now take the same
  hold as the card's other controls: `busy || held` on the host card, `door.busy || held` on the names card. One case per card holds
  the first send on a deferred promise and asserts the field disabled in that window (typing there is impossible by attribute),
  then that the retry sends exactly what the first send carried. Case 16 holds its first send the same way, and its title now says
  "from the press: no key can be typed in flight or while the step shows", which it checks. M39 and M40 (above).
- **F2, a known limit, stated.** Above, under the hold: Remove, a narrowing, is held with its card while a Save's step shows,
  and stays held where the step cannot be confirmed on this device, until an exit; the one sentence on the plan's Table 1, and
  the exits as the review measured them. No code.
- **F3.** The census's header and this note say what it can and cannot see, and that it guards "no value in the send's scope",
  not a proof about closures. One blind spot is closed in one line: Upload's send must hand `() => rowsBodyOf(text.current)`, so
  the rows kept in a local of any name are red, with a self-check case (M41). It is not grown into a parser.
- **F4.** Both assertions added: the door idle while Clear's step shows (as it was already checked for Upload's), and the other
  card's answer case draws a list, so Clear's freeing is checked with the box's and Upload's.
- **F5.** Reworded here and in the headers of the two cards and the secret field: the Show toggle and Read again are not held
  (they send nothing); a route change that keeps a field mounted empties it too; the slug holds by card, Remove's own step
  included.
- **F6.** The M30 and M31 rows say what each shows, and round 2's commit sentence names case 18's tail in the note commit.
- **The changed assertions, and why.** Case 16 now holds its first send on a deferred promise and asserts the key field held in
  flight as well (it was asserted only while the step showed); its title is reworded to what it checks. The names "another card's
  answer" case draws a stored list (it drew none), so Clear is drawn and checked; its other assertions are as before. Nothing was
  loosened.
- **Verified**, each file alone through the fleet test wrapper, two workers at most:
  - `settings-decision-model` 72 and `settings-private-names` 32;
  - `secret-field` 3, `secret-field-forms` 17 and `secret-field-sheets` 10;
  - `settings-retry-census` 10;
  - `control-census` 13 and `tap-targets` 101;
  - the console's type check, clean;
  - the section's browser file, run locally through the wrapper (the hold's window changes what a control shows), 80 of 80.

## What a merge arms

Nothing a running session sees. Every decision-model row ships `off` on the server, and the cards send only on the operator's tap.
The section is drawn only under `overlord-v1`, which no server advertises yet. The secret field's sheets read as before.

## Harness dependence

None added. Every card is the console over the server's own doors (ruling 9).

## Known limits

- **A view this console cannot read blanks the decision model's cards** (`unknown-row-refuses-the-read`, review 4139 F4, ruled a
  limit). The shared reader refuses the whole view for any of these: a row id the catalogue does not know, a held cause outside
  `DECISION_HELD_CAUSES`, a host kind outside `DECISION_HOST_KINDS`, a ceiling outside today's bounds, or a side with a key it does
  not know.
  - On a first read that fails this way, the host card draws its line alone (neither Save nor Remove the key), and the rows card
    draws nothing.
  - After an answer, the last view stays drawn beside the line.
  - The console and the server ship together, so such a view means a console older than its server. The line keeps the reader's
    detail, says so, and offers Reload.
  - The coordinator tickets "an unknown row is dropped, not the view" for a server piece; the shared reader is not this PR's.
- **The section's reads are read once on mount and after each answer, not polled**, as home C's cards.
- **The item secret panel keeps its value in component state** (the coordinator's ticket).
