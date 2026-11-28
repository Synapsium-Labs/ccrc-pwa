# Overlord W2 carries, first batch: notes for the ledger

Wave 259, run 4200, ticket `w2-carries-1`. Two small fixes carried from reviews, in one pull request: a server test that could fail by
chance (issue #3667), and the Settings › Overlord hold until a card's retry has been sent (review 4191 F1 to F3 of #3612). Main at
dispatch: `cc113350db`. No deviation number was allocated; departures are recorded by slug below. Commits: one per task, then this
note.

## Task 1: the test box admin tests search only known text (#3667)

`server/test/testbox-admin-routes.test.ts`, the case "a POST answers the status read AFTER the act, not what the act printed or the
caller sent", searched the whole serialised answer for the port's four digits. An event's actor ends in eight hex characters of a
random session's id hash, and events carry clock times, so either could hold the digits: a pull request that touched neither the file
nor the route went red on it.

- **What it checks now.** The answer has exactly its four keys; the status and the result equal the stubs' values; each event's actor
  is the session's own device label and eight hex characters, and each event time is an integer. Those two values are then replaced
  by placeholders, and the search for the port, the address and the user as sent runs over what is left: the stubs' text, the
  ledger's vocabulary, the fixture's node id and a row id, none of which holds any of them. So an echo anywhere in the answer still
  shows, and chance never does. A comment in the case says why it cannot collide.
- **The user as sent.** The case sent `root`, which is also the status read's login, so the old search never tested the user. It
  now sends `deploy` (a valid login word), so an echo is told apart from the status.
- **The forced collision.** The case runs twice (`it.each`): the second row logs in with the device label `device 2222`, so every
  event's actor holds the port's digits. Red under the old search (measured: the actor read `device 2222 d70e22c6`), green now.

### The sweep

Searched: every `not.toContain` and `not.toMatch` in the server's `testbox-*`, `build-capture-lane` and `claude-build-capture` test
files and the agent's `testbox-admin-op`, `testbox-op` and `testbox-capture-*` test files, keeping each whose literal is short or
made only of digits and hex letters, and reading what each searches.

- **Found and fixed: `server/test/testbox-admin-verb.test.ts`**, the case "status never prints an address or a path, …": it searched
  the verb's status output for `2222`, and that output carries the act's start time, `Date.now() - 1000`, thirteen digits from the
  clock (about one run in a thousand). The start time's text is replaced by a placeholder before the search (the case's read
  already checks it is the act's `startedAt`), and a second row starts the act at the newest time at most ten seconds back whose last
  four digits are the port's, inside the 45-second reap window: red under the old search, green now.
- **Read and left:** every other hit searches a long secret (20 characters or more, or a whole key line), a word with letters no hex
  id holds (`shadow`, `rm -rf`, `PRIVATE KEY`, paths, host names), a fixed text (a sentence table, a script's source), or an array by
  element (`fds`). None can be produced by a random id or a time.

### Mutation rows (task 1)

Each mutant was made in the source, run against the case, and reverted; the product files are unchanged.

| Row | Mutant | Before the fix | After the fix |
|---|---|---|---|
| T1 | the route answers `result: { ...resultOf(…), ...fields }` (the caller's fields come back) | 2 of 2 rows red (the search) | 2 of 2 red (the exact result) |
| T2 | the route writes `port <port>` into each event's `code` | not run | 2 of 2 red (the search over known text) |
| T3 | the verb prints the port in `installedTag` (`v2222.0.0`, which the strict reader accepts and the case's `toMatchObject` does not check) | 2 of 2 rows red | 2 of 2 red |
| T4 | the forced collisions (device label `device 2222`; a start time ending `2222`) | 1 of 2 rows red, in each file | 0 red |

## Task 2: a card stays held until its retry has been sent (review 4191 F1 to F3)

The confirm put the step away in one render, and the section sent the retry after it, from an effect. For that one task the key field
and the names box were enabled before the retry read them. The section's hold (`OverlordSection`'s `held`) now also takes "a retry is
pending for this card": `asking === card && (stepUp.needed || pending?.card === card)`. A card is held while its step shows and, once
the confirm lands, until the effect has sent its retry; a retry that sends a request then holds the card by its door's `busy`, and one
that sends nothing (a key or a box emptied while the step showed) frees it. Nothing else moves: no door call, word, retry maker or
request, and the account sheets' use of the secret field is untouched.

- **The window, made visible.** The retry's request is made inside the section's effect, before anything renders again. So a mocked
  request that reads the controls' `disabled` reads the page as it stands when the retry reads the field. One case per card reads
  them there: `settings-decision-model` "15. the card is held until its retry is sent: …" (the host inputs, the key field, Save and
  Remove) and `settings-private-names` "the card is held until its retry is sent: …" (the box, Upload and Clear). Each was red before
  the fix: every control read enabled. No pure function was lifted, because the window could be seen (slug
  `the-window-is-seen-so-no-truth-table`). What the cases show is the DOM at the moment of the retry's request in the console's test
  environment; they make no claim about when a browser paints.
- **The hold does not stick.** `needed` turns false only through a confirm here (the section's step-up assumes fresh, so it is the
  refusal flag alone), a `step-up` outcome sets that flag in the same continuation that hands the retry, and every `ask` sets `asking`
  and `pending` together, so a pending retry can stand with the step away only between the confirm's render and its effect. Exits, one
  case each where the new term could have broken it:
  - the retry sent and answered: the two probe cases end on the answer and check the card freed;
  - a refused retry: "15. a refused retry frees the card" (new);
  - another card's answered act: the existing "16. another card's answer hides the step; …" (freed, checked);
  - another card's step: the existing "18. another card's step drops Save's retry: …" (freed, checked);
  - a step that cannot be confirmed on this device: "15. a step that cannot be confirmed on this device keeps the card held until
    another card's answer frees it, and no Save is sent" (new; the step start answers `step-up-locked`). This also closes #3612's
    "No case covers a locked step with the host card held";
  - leaving the section: "15. leaving the section frees the card: mounted again, nothing is held, no step shows and no Save is sent"
    (new). No mutant of the hold's condition can redden it, because the section's state is per mount; it holds the exit as a fact.
- **The words**, each made true:
  - the secret field's header, the host card's and the names card's: held "from the press until its retry has been sent", by the send
    in flight, then the step, then from the confirm until the retry is sent, whose own send in flight follows;
  - the section's header and `SectionCtx.held`'s comment: held while the step shows and, once the confirm lands, until the retry is
    sent;
  - the names card: "Read again is not held: it sends no write (it sends the card's read, and reads no field)", for "sends nothing";
  - the retry census's header: "the send" is the function named `send` in each card file, the one that calls the door; the names
    card's `upload` keeps the parsed rows in its own scope, the scope the request's body arrow is made in, and no closure made there
    names them today, which the census does not check beyond the arm on that arrow; the comment caveat applies to the door call's arm
    and every request arm alike (each is a search of the whole source); and a local of another name kept BESIDE the unchanged request
    line is listed as unseen.

### Mutation rows (task 2)

Each on the final code, the two settings files run whole.

| Row | Mutant of `held` | `settings-decision-model` | `settings-private-names` |
|---|---|---|---|
| H1 | the new term removed: `asking === card && stepUp.needed` (the old hold) | 1 of 76 red (the probe) | 1 of 33 red (the probe) |
| H2 | a hold that sticks while the card was the last to ask: `asking === card` | 2 of 76 red (the refused retry, and case 17) | 0 of 33 |
| H3 | the card guard dropped: `stepUp.needed \|\| pending?.card === card` | 3 of 76 red (the locked step, cases 16 and 18) | 1 of 33 red (another card's answer) |

## Corrections for the w2-settings note

The ledger guard refuses an edit to an existing file under `docs/superpowers/programs/` from this branch, so these replace sentences
of `overlord/w2-settings.md` when the coordinator folds the notes (slug `w2-settings-corrections-carried-here`):

- "The card is held from the press to the end of its step" becomes "The card is held from the press until its retry has been sent",
  and "the section holds them while the step shows (`held`)" becomes "the section holds them while the step shows and, once the
  confirm lands, until it has sent the retry (`held`, review 4191 F1)".
- "The controls that send nothing are not held: the key field's Show toggle and the read's Read again" becomes "The controls that send
  no write are not held: the key field's Show toggle, which sends nothing, and the read's Read again, which sends the card's read".
- In "What puts the step away": "the confirm, which sends the retry first" becomes "the confirm, after which the card stays held
  until the section has sent the retry, and that send in flight holds it in turn".
- "No case covers a locked step with the host card held" is dropped: case 15's locked-step case covers it.
- The census paragraph: "The fact it guards is that no value stands in a send's scope" becomes "… in the scope of the function named
  `send` in each card file; the names card's `upload`, which calls it, keeps the parsed rows in its own scope, unchecked"; the
  `toContain` caveat extends to every request arm; and "a local of another name kept beside the unchanged request line" joins "It
  cannot see".

## Departures (slugs)

- `the-window-is-seen-so-no-truth-table`: the brief's fallback (a pure function and its truth table) was not needed, because the probe
  cases go red without the fix.
- `w2-settings-corrections-carried-here`: the brief's note changes to `w2-settings.md` are written above for the fold, not edited in
  place (ledger guard).
- `routes-case-sends-deploy`: the routes case sends the user `deploy`, not `root`, so the user as sent can be told from the status.
- `server-test-typecheck-two-files`: the server's whole test type check was killed by the local test slice's memory cap (6 GiB);
  the two touched files were type-checked alone (clean), and CI's typecheck runs the whole.

## Harness dependence

None added: both tasks change tests and one condition of the console's own section.

## Verified

Each file alone through the fleet test wrapper, two workers at most, fixture homes only:

- `testbox-admin-routes` 45 and `testbox-admin-verb` 51; the two files' type check, clean;
- `settings-decision-model` 76 and `settings-private-names` 33;
- `secret-field` 3, `secret-field-forms` 17 and `secret-field-sheets` 10;
- `settings-retry-census` 10, `control-census` 13 and `tap-targets` 108;
- the console's type check, clean;
- the section's browser file, run locally through the wrapper, 80 of 80.

## Known limits

Closed here: #3612's "one scheduler task after the confirm" (the fields enabled before the retry reads them), and its "no case covers
a locked step with the host card held". Kept:

- The retry census is a source check, not a proof about closures, with the blind spots its header lists.
- A Save's step holds the key's Remove (a narrowing) with its card, and a step that cannot be confirmed on this device holds it until
  another card's answered act or step, or leaving Settings (#3612, review 4183 F2).
- The probe cases read the DOM at the moment of the retry's request in the test environment; nothing here measures a browser's paint
  order.
- #3612's other limits stand as written in `w2-settings.md` (a view this console cannot read; reads not polled; the item secret panel).
