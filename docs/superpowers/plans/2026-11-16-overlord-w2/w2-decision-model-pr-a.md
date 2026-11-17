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
| `decision-fetch-reads-chunks` (was `decision-fetch-reads-text`) | The adapter takes `fetch: FetchLike` (the Linear client's) | It takes `DecisionFetch`, whose answer has `body`, an async iterable of byte chunks (a `Response`'s web stream is one): the adapter stops reading at the first chunk past the 64 KiB cap (review 2324 F6) and tells a body that is not JSON itself, which `FetchLike`'s `json()` hides. A different port shape, not a second mechanism for one job |
| `decision-call-no-key` | `DecisionCall`'s `unavailable` has four whys | It gains `no-key`: a key that reads absent or unreadable, or a key reader that throws (review 2324 F3), between the caller's plan and the adapter's call sends nothing and says so, rather than folding into `unreachable` |
| `decision-local-literal-only` | A `local` host's endpoint resolves to loopback or private addresses | The coordinator's ruling on review 2324 F2: a `local` endpoint names an IPv4 or IPv6 literal or `localhost`, and any other host name answers `unavailable`, `endpoint-not-literal`, before any resolve. A name could resolve one way for the check and another for `fetch`'s own lookup; a literal closes that window without pinning a connection. The resolve-and-check stays for the literal and `localhost`. Hosted endpoints stay as the plan has them, under PR B's key door |
| `decision-endpoint-unparseable` | (not in the plan) | An endpoint that does not parse makes the adapter's `origin` null and answers `unavailable`, `endpoint-unparseable`, never `host-changed` or `unreachable` (review 2324 F4): the adapter keeps the distinction it received |
| `decision-facts-capped` | "`fact`: a short server-made value" | A `fact` (`doneTest`, `signal`) is capped at `DECISION_FACT_MAX_CHARS` (200), so a longer one is `over-size` (review 2324 F6, the coordinator's choice of cap over quoting). The catalogue, and so every revision, is unchanged |
| `decision-request-per-group` | "It sends one request for every row whose plan is `ask`" | One request per `askedWith` group and state (`decisionModel.ts#decisionRequestGroups`). Rows asked together share one state; two groups in one request would need a state keyed by group, which the wire as read does not describe. Rows of one group whose states differ go in separate requests (review 2324 F1), so the egress screen, the record key, the size and the request all read the same fields. Today only the routing pair shares a group, so a door asking one row sends one request either way |
| `decision-fields-one-kind-each` | `readback.*`'s `request` is "refs: the cited message ids; fact: the done test" | Three fields: `request` (ref, message), `readback` (quoted, rebuilt from the mail ref) and `doneTest` (fact, optional). Each field has one kind. A both-order yes-or-no row swaps its first two fields, so the field order is `request, readback, doneTest` and `a, b, signal` |
| `decision-quoted-field-names-its-ref` | `DecisionField.refKind` belongs to a `ref` field | A `quoted` field may name the `refKind` its text is rebuilt from (`goals`, `readback`, `a`, `b`). It stays an attacker field. Privacy is read from a `message` ref alone |
| `decision-record-read-three-ways` | `decisionRecordOf` answers a row or `null` | It answers `none`, `record` or `unreadable` (a verdict or band word out of this build's vocabulary, or a failed read). An unreadable record is never reused; the row is asked anew, and its answer is not recorded over the row holding the key. No overloaded null at the seam |
| `decision-state-hash-of-fields` | `stateHash` is "SHA-256 of the canonical state sent" | The hash is of the row's fields before the encoder draws opaque ids. The state sent carries fresh opaque ids each call, so hashing it would make every key new and no record would ever be reused |
| `decision-reserve-takes-no-kind` | `reserveDecisionCalls(db, rows, day, kind, calls)` | No `kind`: `reserved` is one column whatever the kind. `settleDecisionCalls` takes the kind and counts the attempts there |
| `decision-boot-release-through-settle` | The boot step sets `reserved` to 0 for today and counts it as `maintain` | `releaseDecisionReservations` settles every day's stale reservation as maintenance through `settleDecisionCalls`, so `decision_days` keeps its two writers. Not wired at boot until PR B |
| `decision-model-words-declared` | (not in the plan) | `mail-routes.test.ts` scans every quoted kebab word in `server/src/coord` and refuses one no vocabulary declares. The decision model's words are declared by lists: L0 gains `DECISION_MALFORMED_WHY` and `DECISION_QUESTION_TYPES`, L1 gains `DECISION_EGRESS_WORDS` and `DECISION_RECORDED_EGRESS`, and one guard, `decisionModel.ts#isDecisionModelWord`, derived from those lists and L0's others, admits them. `'content-type'`, a header name, joins the scan's `NOT_CODES`. Since review 2324 F6, `DECISION_MALFORMED_WHY` holds every `malformed` reason in one list, the reader's six with the adapter's two. The guard's breadth over every file of `server/src/coord` is its design (the coordinator's ruling) |
| `decision-wire-not-re-read` | "The builder re-reads the vendor's own reference at build time" | Not re-read: the plan names no address for the reference, and the build reaches no network. The codec and the recorded fixture (`server/test/fixtures/decision-model/`) speak question 2's shape as the plan records it. The coordinator's ruling on review 2324 F7: the vendor wire is checked before any row leaves `off`, and that is decision model B's builder's act. B's first task re-checks `noul`, `answers`, `probabilities` and `confidence` against the vendor's published reference, records the source in B's PR notes and adds a contract fixture of a real answer's shape, so a wrong name reds a suite instead of burning the ceiling; B's arm door refuses `shadow` until that fixture's suite exists. The coordinator carries this into B's brief |

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
- **The migration slot.** 86 by position. Portfolio B (#2904) took 83, and this branch first merged `main` to take 84 (the
  coordinator's word, mail 21993). Responses B (#2914) then landed 84, and this branch merged `main` to take 85 (mail 22094).
  Overlaps A (#2949) then landed 85, and this branch merged `main` again to take 86, keeping both sides (mail 22345).

## 3. Review 2324, fix round 1

Review run 2324 read the tip `2887f9609`; the coordinator ruled every finding into this pull request (mail 22241).

- **F1, one state per request.** `decisionModel.ts#decisionRequestGroups` (L1) splits the rows by `askedWith` group and
  state hash, and the caller screens, keys, sizes and encodes that one state. The reviewer's case is a test: two routing
  rows, a secret in the second's state, the first already recorded; the secret is screened and never sent. A mutant that
  groups by the lead alone (`DM-GROUP-1`) reds.
- **F2.** `decision-local-literal-only`, above. `isLiteralHost` (L1, a literal or `localhost`) joins `MUTANT_SETS`.
- **F3, no reservation outlives a throw.** Everything after the reservation runs in one `try`; a throw settles to 0 attempts
  first and then goes on, and a settle the store could not write is logged (`console.warn('ccrc-server: …')`). The adapter
  reads a throwing key reader as `no-key`. Tests: a throwing ask, a throwing key reader through the one adapter, a failed
  settle.
- **F4.** `decision-endpoint-unparseable`, above.
- **F5.** An answer whose record write finds the key taken (`recorded: false`: an unreadable record, or a concurrent
  writer's) carries `recordId: null`, never another answer's record.
- **F6.** The body is capped while it is read (`decision-fetch-reads-chunks`); every `malformed` reason is in
  `DECISION_MALFORMED_WHY`; a required list holding an empty text is missing, and duplicate opaque ids throw in
  `encodeDecisionRequest`; facts are capped (`decision-facts-capped`).
- **F7.** `decision-wire-not-re-read`, above.

## 4. Measured

- The new suites: `decision-model-catalogue` (28), `decision-model-decide` (45), `decision-model-http` (28),
  `decision-model-records` (13) and `decision-model-ask` (21), green.
- Mutation: seven new deciders in `MUTANT_SETS` (`planDecision`, `serveCap`, `maintainCap`, `isPrivateAddress`,
  `encodeDecisionRequest`, `readDecisionAnswers`, `bandOf`), 55 mutants, every one killed, floors of 1. The adapter's and the
  caller's guards were mutated by hand, each from a saved copy, and each reds its suite: the retry count, the address
  check, the deadline's `Cancel`, the bearer header, the key read, the 413 arm; the transaction guard, the host-snapshot
  check, the fresh no-record rule, the fresh no-reuse rule, the settle on a failed call and the armed gate's own line.
