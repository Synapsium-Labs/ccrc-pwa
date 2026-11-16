# Overlord W2 decision model, PR A: notes for the ledger

The worker's notes for PR A (Tasks 1 to 5 of [`w2-decision-model.md`](../2026-11-16-overlord-w2/w2-decision-model.md)), run
2297. The coordinator folds them into the programme ledger on its own pull request. Each departure is named by slug; no
deviation number is taken here.

## In short

- PR A ships the catalogue (`shared/decisionModel.ts`), the deciders (`server/src/coord/decisionModel.ts`), the port
  (`decisionModelPort.ts`), its one HTTP adapter (`decisionModelHttp.ts`), the records and day counts
  (`decisionModelStore.ts`, one migration) and the one caller (`decisionModelAsk.ts`).
- Nothing is reachable. Nothing imports `decisionModelAsk.ts` or the adapter outside the tests, every row reads
  `DECISION_ROW_DEFAULT` (`off`), and no route, lane or timer is added. PR B wires it.
- No test reaches a network or a real model. The adapter runs against a fake `fetch` and a fake resolver, and the caller
  against a double port over a real `coord.db` in a fixture home.

## 1. Departures from the plan's text

Each is small and is recorded so the ledger and PR B read the code, not the plan, where they differ.

| Slug | What the plan says | What PR A does, and why |
|---|---|---|
| `decision-ask-takes-a-store-port` | `DecisionAskDeps.db: DatabaseSync`, and the caller opens the reservation transaction itself | `DecisionAskDeps.store: DecisionAskStore`, a consumer-declared port in `decisionModelPort.ts`, built by `decisionModelStore.ts#decisionAskStore`. `core-vocab.test.ts`'s coord-ring rule lets only the store files hold the handle, so the L4 caller reaches the database through the port. `reserve` runs the plan and the reservation in one transaction, row by row, so a concurrent gather sees each reservation (the plan's step 4 unchanged). PR B's `index.ts` passes `decisionAskStore(db)` |
| `decision-wire-type-in-l1` | `DecisionWireRequest` is declared in the port (L2) | It is declared in `decisionModel.ts` (L1), where the encoder makes it, and the port re-exports it. An L1 file importing an L2 type would point outward |
| `decision-fetch-reads-text` | The adapter takes `fetch: FetchLike` (the Linear client's) | It takes `DecisionFetch`, whose answer has `text()`: the adapter measures the 64 KiB cap and a body that is not JSON itself, which `FetchLike`'s `json()` hides. A different port shape, not a second mechanism for one job |
| `decision-call-no-key` | `DecisionCall`'s `unavailable` has four whys | It gains `no-key`: a key that reads absent or unreadable between the caller's plan and the adapter's call sends nothing and says so, rather than folding into `unreachable` |
| `decision-request-per-group` | "It sends one request for every row whose plan is `ask`" | One request per `askedWith` group. Rows asked together share one state; two groups in one request would need a state keyed by group, which the wire as read does not describe. Today only the routing pair shares a group, so a door asking one row sends one request either way |
| `decision-fields-one-kind-each` | `readback.*`'s `request` is "refs: the cited message ids; fact: the done test" | Three fields: `request` (ref, message), `readback` (quoted, rebuilt from the mail ref) and `doneTest` (fact, optional). Each field has one kind. A both-order yes-or-no row swaps its first two fields, so the field order is `request, readback, doneTest` and `a, b, signal` |
| `decision-quoted-field-names-its-ref` | `DecisionField.refKind` belongs to a `ref` field | A `quoted` field may name the `refKind` its text is rebuilt from (`goals`, `readback`, `a`, `b`). It stays an attacker field. Privacy is read from a `message` ref alone |
| `decision-record-read-three-ways` | `decisionRecordOf` answers a row or `null` | It answers `none`, `record` or `unreadable` (a verdict or band word out of this build's vocabulary, or a failed read). An unreadable record is never reused; the row is asked anew, and its answer is not recorded over the row holding the key. No overloaded null at the seam |
| `decision-state-hash-of-fields` | `stateHash` is "SHA-256 of the canonical state sent" | The hash is of the row's fields before the encoder draws opaque ids. The state sent carries fresh opaque ids each call, so hashing it would make every key new and no record would ever be reused |
| `decision-reserve-takes-no-kind` | `reserveDecisionCalls(db, rows, day, kind, calls)` | No `kind`: `reserved` is one column whatever the kind. `settleDecisionCalls` takes the kind and counts the attempts there |
| `decision-boot-release-through-settle` | The boot step sets `reserved` to 0 for today and counts it as `maintain` | `releaseDecisionReservations` settles every day's stale reservation as maintenance through `settleDecisionCalls`, so `decision_days` keeps its two writers. Not wired at boot until PR B |
| `decision-wire-not-re-read` | "The builder re-reads the vendor's own reference at build time" | Not re-read: the plan names no address for the reference, and the build reaches no network. The codec and the recorded fixture (`server/test/fixtures/decision-model/`) speak question 2's shape as the plan records it. PR B, or whoever sets the first host, checks the field names against the reference before a row goes to shadow |

## 2. What the plan left open, and how it is built

- **The opaque ids.** The caller draws sixteen per request from `Entropy.below(2 ** 32)` (eight hex digits each,
  deduplicated): `Entropy.hex` refuses under 16 bytes. A choice's options, its `none` option, the question keys and a
  swapped pair's two labels are all opaque. The `none` option's id is held apart from the slugs, so a programme slug
  spelled `none` reads as an option, never as the `none` answer.
- **The routing rows' state.** `request` goes as `quoted`, and each candidate goes under its opaque option id carrying its
  goals as `quoted`. No slug is sent.
- **A swapped pair.** A both-order yes-or-no row puts its first two fields under opaque labels, and its two questions name
  the labels in swapped order before the catalogue's instruction ("The request is under x… The readback is under x…").
- **The canary strings.** `DECISION_CANARY_OVERRIDES` holds five neutral override strings. PR B's canary uses them.
- **The migration slot.** 84 by position (the coordinator's word, mail 21993): portfolio B (#2904) took 83, and this
  branch merged `main` once to take the next slot, keeping both sides. Other open pull requests also hold 84; whoever
  lands second renumbers at landing, on the coordinator's word.

## 3. Measured

- The new suites: `decision-model-catalogue` (28), `decision-model-decide` (45), `decision-model-http` (28),
  `decision-model-records` (13) and `decision-model-ask` (21), green.
- Mutation: seven new deciders in `MUTANT_SETS` (`planDecision`, `serveCap`, `maintainCap`, `isPrivateAddress`,
  `encodeDecisionRequest`, `readDecisionAnswers`, `bandOf`), 55 mutants, every one killed, floors of 1. The adapter's and the
  caller's guards were mutated by hand, each from a saved copy, and each reds its suite: the retry count, the address
  check, the deadline's `Cancel`, the bearer header, the key read, the 413 arm; the transaction guard, the host-snapshot
  check, the fresh no-record rule, the fresh no-reuse rule, the settle on a failed call and the armed gate's own line.
