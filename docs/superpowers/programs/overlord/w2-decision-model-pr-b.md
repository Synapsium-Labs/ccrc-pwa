# Overlord W2 decision model, PR B: notes for the ledger

The worker's notes for PR B (Tasks 6 to 9 of [`w2-decision-model.md`](../../plans/2026-11-16-overlord-w2/w2-decision-model.md)), run
2383. The coordinator folds them into the programme ledger on its own pull request. Each departure is named by slug; no
deviation number is taken here.

## In short

- PR B ships per-row arming (`off`, `shadow`, `armed`) journalled as authority, the host and the lines (one migration, three
  tables), the operator's six doors on five paths behind the account gate, line admission by the one-sided Clopper-Pearson
  bound, the injection canary, drift, `applyDecision` and `gateOutcome`, the egress, labels and state-read ports, and the daily
  anchor-set lane. `deps.decisions` is wired.
- **Nothing changes at merge.** Every row still reads `off` (no `decision_rows` row is seeded) and the composition root passes an
  empty labels source, so no line can be admitted and no row can be armed. A model is called only after the operator sets a
  host and a key and switches a row to `shadow`, both through the doors; a hosted call is screened against the private-name
  list (`egress-screen-reads-the-list`).
- **Fix round 1 (review 2418)** binds the key to the origin it was entered for, reorders the key doors (host and holds first),
  wires the egress screen, reads an armed gate against its line's key, fails an unreadable gate closed, and takes the nits; each
  is a departure below or a note in section 3.
- **The vendor wire was re-read before any row can leave `off`** (the coordinator's ruling on review 2324 F7). Every name the
  codec uses is as published, and a contract fixture now holds it (below).

## 1. The vendor wire, re-read (review 2324 F7)

Read on 2026-11-17 from the vendor's own API reference (its OpenAPI schema, `docs.typesafe.ai/api`, and its quickstart,
`docs.typesafe.ai/introduction/quickstart`) and from two gateways' reference pages for the model (an inference gateway's
"decision models" reference and a model marketplace's model page). The sources agree on every field the codec reads:

| Where | Name | As PR A had it |
|---|---|---|
| request | `model`, `state` (a string, an object or an array), `questions` (a map of question names) | yes |
| a question | `type`, `instructions`, `criteria` | yes |
| question types | `noul` (criteria `{ true, false }`, optional) and `choice` (criteria: 1 to 255 option keys) | yes |
| answer | `model` (the resolved model), `answers` keyed by the request's question names | yes |
| a `noul` answer | `{ type: 'noul', noul: <p(yes)> }`, no `confidence` | yes |
| a `choice` answer | `{ type, choice, confidence, probabilities }` | yes |

Two facts the reference adds, neither a change to the codec:

- **An answer carries keys the codec never reads**: `usage` (`input_tokens`, `output_tokens`), and on gateways `id`,
  `provider` or `meta`. The reader ignores them; the contract fixture carries them, so a reader that refused an unknown key
  would red.
- **The resolved model is a dated version** (a `model` like `<name>-1.14.0`), while a floating alias names the newest. The
  pin (H6: an answer from another model is `malformed`) compares the answer's `model` with the host's `modelId`, so the operator
  must set the resolved id, not a floating alias, or every answer reads `malformed`. The W2 Settings piece's host card should say
  so. The gateways also differ from the vendor in the endpoint path and the model-id prefix; the endpoint stays the operator's
  typed URL, with no host or path committed.

The suite is `server/test/decision-model-wire-contract.test.ts` with `server/test/fixtures/decision-model/contract-answer.json`
(a real answer's shape, neutral values). It is red with the reader's `noul` read renamed (measured: 2 of 6 red, restored from a
saved copy). The arm door's `shadow` lands in the same pull request as this suite, which is the ruling's order.

## 2. Departures from the plan's text

| Slug | What the plan says | What PR B does, and why |
|---|---|---|
| `doors-step-up-follows-7-5` | Every write asks the step-up (F4, F14) | The coordinator's ruling (review 2298, the W2 Settings plan's SQ1): a widening asks it, a narrowing never does. `decisionLines.ts#decisionStepUp`: arm and key `PUT` always; key `DELETE` never; off and ceiling exactly when `decisionRowDirection` says `widens` (an armed gate off, a higher ceiling). `shadow` to off, an advice row off and a lower ceiling are one tap. Every write still calls the account gate, so each refuses `auth-off` while sign-in is dark |
| `gate-outcome-shadow-skipped` | `gateOutcome`: `clear-yes` and `skipped` return the code verdict | The coordinator's ruling (RL11): `shadow` returns it too; a gate in shadow was never armed |
| `decision-check-carries-origin` | `applyDecision` row 5 compares the check's host kind, origin and model | PR A's answered `DecisionCheck` had no `origin`. It gains `origin` (additive), filled by `gatherDecisions` |
| `apply-clear-needs-the-verdict` | Rows 8 and 10: `p` at or over the line | A yes-or-no row clears only on the verdict `yes` with `p` at or over the line, and a choice row picks only on an option or `none`: a `no` with a high `p` is a no. Stricter, so it only narrows |
| `server-slot-api-landed-first` | Question 6's three functions join `ledgersSecrets.ts` | Private names B landed the `.server` slot API first (`writeServerSecret`, `readServerSecretValue`, `removeServerSecret`, the sweep and the re-key). PR B adds `readServerSecretMeta` (the read's `setAt` and `masked`), the slot `decision-model-key`, its reader `decisionModelHttp.ts#readDecisionModelKey`, and widens the "only caller" sentence |
| `decision-row-read-three-ways` | `decisionRowOf` answers the row | `decisionRowRead` answers the row (an absent row as the default) or `unreadable` (a word out of the vocabulary, half or an out-of-range armed line, a ceiling that is not an integer from 50 to 5000, review 2418 F5). A door answers `unavailable` (the read) or `journal-unreadable` (a move, `row-unreadable`). Outside a door an unreadable row fails closed (review 2418 F4, the coordinator's ruling): an advice row reads `off`, and a gate reads armed and held (`decisionModelStore.ts#UNREADABLE_GATE_SIDE`), so it shuts and its outcome goes to the operator, with a `console.warn`. Only a downgrade or a hand edit can make one |
| `authority-gate-checked-against-catalogue` | The record carries `gate` | The grammar refuses a record whose `gate` disagrees with the catalogue's direction for its row, so no record can read a gate's widening as advice's narrowing |
| `decision-rows-against-the-fold` | (not in the plan) | `authorityAgainstFold` holds a decision-row move's stated `from` against the fold's side for that row, as it does for the rung, the account set and the model class, so a `from` the journal contradicts reads `diverged` |
| `held-needs-a-cause` | `heldCause` on the move | A move to `held` from a row not held must name its cause; the store checks it before the record is appended, so a throw never leaves a record with no row |
| `arming-store-port` | The doors and the lane call the store's writers inside their own `tx()` | `single-definition/core-vocab.test.ts`'s coord-ring rule lets only store files hold the handle. The doors and the lane reach the database through `DecisionArmingStore` (L2, `decisionModelPort.ts`), built over coord.db and the journal by `decisionModelStore.ts#decisionArmingStore`; `inTx` keeps the off door's fallback and the key doors' holds in one transaction. The store's row, host and line types moved into the port |
| `key-door-local-literal-only` | `decideKeyDoor` row 4 checks the resolved addresses | PR A's ruling (`decision-local-literal-only`) applies at the door too: a `local` endpoint names an address literal or `localhost`, else `bad-endpoint`. The door also refuses a bare `?` or `#` and an `@` in the authority, and a key with a line break (U+2028 and U+2029 included) |
| `arm-line-is-the-current-line` | Arm row 5: "`line` names another" | `line`, when given, must be the current line's id (the Settings piece's Approve sends `offered.id`, which is the current line) |
| `canary-an-option-defined` | Question 18: "the perturbed answer names a different option, `none` included" | The effect at the line is compared: an answer names an option only at `p` at or over the line; a lost option (to another, to `none`, to `unsure`, or below the line) crosses, and so does a gained one. Two answers neither of which names an option do not |
| `anchor-drift-needs-a-whole-set` | `anchorDrift`: 4 of 20 moved | A baseline or a reading that is not 20 bands counts as drift (a held gate narrows). The lane never compares a partial reading: one unanswered anchor writes nothing that day |
| `admission-reasks-on-case-count` | Re-admission "when the labelled cases changed since the last admission" | The lane re-asks when there is no current line under today's key, or the current line's `canaryExpected` differs from 5 × the cases that resolve. A count, not a fingerprint: a case replaced by another of the same count is not seen until the count moves. The label queue may add a fingerprint column when it lands. Accepted for this PR (review 2418); the label queue adds the case fingerprint (a carry, section 4) |
| `state-reads-inline-only` | "the state reads over the goals and mail readers" | The composition root's `DecisionStateReads` answers a case's inline fields and `programme` refs, and `unresolvable` for a `message`, `goals-version` or `mail` ref. Those readers come with the label queue, the first producer of labelled cases; until it lands the labels source is empty, so this is never asked |
| `view-in-l1` | The read's fields in prose | `DecisionModelView`, `DecisionRowView` and `readDecisionModelView` ship in `shared/decisionModel.ts` (the W2 Settings plan's SQ2), and the read is built by `decisionLines.ts#decisionModelViewOf` (L1); `host.endpoint` rides beside `origin` (ruled) |
| `routing-rows-asked-together` | (not in the plan) | `gatherDecisions` completes `askedWith`, so the lane's ask of `programme.pick` also asks `programme.any` when that row is not off, and each is charged for both passes. Within the maintenance cap; noted for the measures |
| `secret-tail-linear-strip` | (not in the plan) | The key door's `PUT` body reaches the pre-existing `shared/ledgers.ts#secretTailOf` through `writeServerSecret`, and CodeQL flagged its `/=+$/` as a polynomial regex on a value the user supplies (`js/polynomial-redos`, high). A loop now sets the trailing `=` aside, with the same answers (the reviewer compared the two over 300,004 fuzzed inputs). No behaviour case tells them apart, so the guard is a source scan, `single-definition/secret-tail-regex.test.ts`, with a planted control: it goes red if an end-anchored run of `=` returns to the file (measured against the old file), not when the strip is deleted; CodeQL is the other guard (review 2418 F7). The coordinator's word: it rides in this PR |
| `key-bound-to-its-origin` | Question 6: the key in its `.server` slot | (review 2418 F1, the coordinator's ruling) The key door writes the host record and its holds first, then the key, recording in the slot's record the origin it was entered for (`writeServerSecret`'s `bound`; the old record is removed before the value is written). `decisionModelHttp.ts#readDecisionModelKey(ccrcDir, origin)` reads the record before and after the value and answers the value only to a call whose host snapshot has that origin, else `not-bound`, which the call reads as `no-key`. So neither a key stored but not applied nor a key changed while a gather was in flight reaches another origin. A failed transaction changes nothing (`write-failed`); a key write that fails after it answers `stored-not-applied`, whose Table 11.6 row now says so |
| `key-removal-holds-first` | Question 11: removing the key holds every armed gate | (review 2418 F6; review 2431 L1) The holds and `keySetAt` null commit first, on every readable row (an unreadable one already reads shut for a gate), then the slot is removed, so a removal that fails leaves every armed gate held (`stored-not-applied`) and a key set again never re-opens one. Remove key ALWAYS removes the key: when the hold transaction itself fails, the slot is removed anyway and the door answers `removed-not-held` (a new word, Table 11.6); only when both fail does it answer `write-failed` |
| `egress-screen-reads-the-list` | "until private names B wires the real screen" | (review 2418 F2) Private names B landed first, so the hosted screen is `decisionModel.ts#decisionEgressOf` over `readPrivateNameList`: `no-list` only when no list was ever uploaded, `unreadable` (the hosted call is refused) when the list cannot be read or the matcher cannot trust it, and otherwise `hit` or `clear` from `privateNameHits`. The record's egress word tells `clear`, `skipped-no-list` and `not-hosted` apart |
| `gate-read-against-its-armed-key` | `applyDecision` row 6: the line's id | (review 2418 F3; review 2431 L4) `applyDecision` takes the key the gate's armed line was admitted under (`armedLineKey`: its line id, revision, host kind, origin, model), and a gate shuts unless the key's id is the armed line's and the check was gathered under that key, so an armed gate is never served on an answer to a question text it was not armed for, nor read against the current line's key |
| `key-door-header-and-floor` | Row 1: a one-line key of at most 4096 | (review 2418 F9; review 2431 L3, the coordinator's ruling: a key the masker does not catch is never stored) The door refuses a `modelId` with a line break (`isOneLine`) and a key that is not visible characters a header value carries (no space, tab, control character, DEL, no-break space or soft hyphen, nothing above U+00FF), or is under the masker's 20-byte floor once its trailing `=` is set aside, each `bad-request`. The masker's catch is measured, not a rule the door could restate, so the key door asks it first, beside the lane's rows, and refuses `bad-request` with nothing changed unless it answers `masked`; a write whose own registration says otherwise removes the key and answers `stored-not-applied` |

## 3. What the plan left open, and how it is built

- **The migration slot.** 95 by position on this push: account organization D (#2958) landed 90, designation A (#2950) 91,
  done tests A (#2964) 92, the programme work map WM0 (#2974) 93 and forecasts A (#2987) 94. Gates A (#2993) and handoffs
  (#2934) land first at 95 and 96, so this renumbers to 97 (or the next free slot) in the merge the coordinator asks for at
  acceptance; a migration's number is its position, so it cannot be 97 before 95 and 96 are on main. Three tables and an
  index, no seed.
- **Review 2418's nits, as taken (F9).** The arm, key `PUT` and key `DELETE` doors ask their step-up from
  `decisionLines.ts#decisionStepUp`, the one rule; the DNS resolver is built once in `index.ts` and carried on `deps.decisions`
  (`server.ts` no longer builds one); `DecisionAskDeps.currentLine` takes the call's host snapshot, and `keySet` its origin.
  A no-op off or a lower ceiling on a never-moved row, over an incoherent guard with no head row, still lands `row-only`: it
  fails closed and follows W1's rule (ruled).
- **Review 2431 (round 2).** The read door shows a key only when one is stored for the current host's origin (L2), and the
  unreadable-row warning is logged once per row per episode, not once per read. A hold the authority fold reads as a widening
  while the journal is behind the database (a tail cut) still throws inside `holdRows` after an earlier row's record was
  appended; it is transient, and a retry lands `row-only` (noted, ruled). The lane spends nothing on an unreadable gate, which
  `planDecision` row 2 answers `not-asked` (now tested).
- **Two more found while testing the round.** The key doors' holds read every row before the first hold is journalled, so an
  unreadable row fails the transaction before any record is appended (a record rolled back with its transaction would stand in
  the journal with no row). And the bound key reader keeps `absent` and `unreadable` apart for a slot with no record: a directory
  or a link where the value file goes reads `unreadable`, as before.
- **The refusal words.** `shared/refusal.ts#DECISION_MODEL_REFUSALS`, ten words with their statuses (question 13), registered
  in `OVERLORD_GROUPS` and in Table 11.6 with the data file.
- **The authority kind.** `authority-decision-row`, `{ kind, opKey, row, gate, from, to }`; `authorityFold` gains
  `decisionRows` (question 12's fold); a Confirm record leaves it as it stood.
- **Every row ships `off`.** `OVERLORD_AUTHORITY_TABLES` gains `decision_rows`, which no migration seeds, so a box that upgrades
  with no authority head row boots coherent (tested).
- **The lane's row.** `decisionAnchors`, daily (`DECISION_ANCHOR_PERIOD_MS` declared from `QUIZ_LANE_PERIOD_MS`), run by
  `FleetWatcher.sweepDecisionAnchors`.

## 4. Follow-ups

- The restore row after authority journal C (question 12): `restoreStricter` reads `authorityFold`'s `decisionRows`.
- The label queue fills `LabelledCases`, imports `decisionLines.ts#lineCounts`, and brings the ref readers
  (`state-reads-inline-only`).
- **A restore from before the first decision-row move disarms silently** (review 2418 F8): `decision_rows` is empty, so an armed
  gate reads `off` and the lane skips it. That is fail-safe (never wider than a never-armed gate), but the plan's "Rollback and
  older builds" says the next lane pass re-measures each armed row, which it cannot. A restore to an older arming with a weaker
  line is a widening only question 12's `restoreStricter` cures, so that follow-up gates the first armed gate. The coordinator
  carries this to the ledger PR's plan text.
- **The label queue adds the labelled cases' fingerprint** to the line row, so a case replaced by another of the same count
  re-asks admission (`admission-reasks-on-case-count`, accepted for this PR).
- The W2 Settings piece: the host card says the model id must be the resolved, dated id (section 1).
