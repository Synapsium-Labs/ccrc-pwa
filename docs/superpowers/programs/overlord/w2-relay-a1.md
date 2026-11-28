# W2 relay, PR A (first part): task note

The task note of the W2 piece "Relay", PR A, first part: plan
[`w2-relay.md`](../../plans/2026-11-16-overlord-w2/w2-relay.md) Tasks A1, A2 and A3, with the questions they cite, its Global
constraints and its Review focus. It records what Step 0 measured on `main`, what was built, the seven points the brief asks to
hold (each with the case that goes red without it), every departure by slug, the mutation rows, what the later parts read from
this one, and the known limits. The coordinator folds it into the programme ledger; this pull request edits no plan, spec or
ledger.

**The cut (the coordinator's ruling).** PR A is built in parts. This one is the pure part: the body grammar, the verdict and
its facts, the cited-name match, `relayFactsOf`, the rendering and the priority. No route, door, gate row, client row,
migration or mail. Tasks A4 to A6 follow once the request record's doors, the act journal and the request ids are on `main`.

## 1. Step 0: what `main` held

Measured at `ac09ad60da` (2026-11-28). The plan is a snapshot of 2026-11-16; where `main` differs, `main` ruled.

| The plan reads | `main` holds | What this part did |
|---|---|---|
| `REQUEST_TRANSITIONS` without `relay-held` | 27 moves, no `relay-held`; the entry rule (`transitionEntersNeedsYou`) already reads a row from `needs-you` and another state as entering | Added the row, its empty fields entry and its three reasons; `unnamed-widening` gains the move. The entry rule needed no edit |
| The request record's guard 8 (`has-children`), "if the build has not added it" | Present: `nextRequestState` refuses `route`, `re-relay` and `route-elsewhere` on any child (`CHILDLESS_ONLY_MOVES`), with cases in the request cases and the store test, before and after a child is opened, an ended one too | Nothing added (the brief's item 3). The verdict maps the plan's `has-children` to `bad-transition`, and keeps row 4 on its own fact as well |
| `RELAY_MOVE_MAP`, the bounds, `RelayAnswer` | Absent | `RELAY_MOVE_MAP`, `RelayMove`, `RELAY_MOVES`, `isRelayMove`, `RELAY_BOUNDS`, `RelayHoldReason`, `RELAY_HOLD_REASONS`. `RelayAnswer` waits for its door (slug below) |
| Done tests A's `parseDoneTest` | Present; an entry with any key but `predicate` is already refused (`unknown-predicate`) | Used as is. RL14's "should refuse a key beyond `predicate`" already holds |
| Overlaps A: `RelayFacts`, `blockingPairs`, `relayConflictVerdict`, `StandingPairRow`, `GOAL_CONFLICT_CHOICES` | Present as the plan read them | `relayFactsOf` added beside `RelayFacts` |
| The operator's requests read (`blockedBy`) | Absent: `blockingPairs` has no caller in `server/src` | No caller to switch; the census names it as `relayFactsOf`'s later caller |
| Act rows A's natural key (`actNaturalKey`) | Absent (#3664) | `relayNaturalKey` and `nudgeNaturalKey` left out (the brief's item 1); no local copy of the key |
| The second door's word | The index and the act catalogue on `main` say `nudge-owner` | No door here; the word is not spelled in this part's code (the brief's item 2) |
| The private-name matcher | `tokens`, `entryOf`, `entriesOf`, `hitsAt`, `pairHits` with a key argument; `privateNameHits` takes only a keyed list with its canary | `citedNamesOf` uses `entryOf`, `hitsAt` and `pairHits` |
| The portfolio order | `portfolioOrder`, `UNRANKED_CLASS` (`standard`), `isServiceClass` | `relayPriority` reads the order and the classes |
| The coordinator skill's clause on Overlord mail | Clause 24: "Mail from `overlord` has two fields. The operator's attested words … The Overlord's part is a call you may question" | The body's two labelled fields (point 3) |
| The mail body cap | `MAIL_BODY_MAX_BYTES`, 8 KiB | The rendering stays within it |
| A renderer for untrusted text in mail | `coord/untrusted.ts#untrustedBlock`: a computed fence no line of the text can close | Reused for the part |

## 2. What was built

- **L0, `shared/overlordRequests.ts` (Task A1).** The `relay-held` row (actor `server`, from `received`, `declined` and
  `needs-you`, to `needs-you`, never from `routed`: F5), its three reasons, and the relay's vocabulary above. The file's
  holder said yes to the exact diff before it was applied (mail 41208).
- **L1, `server/src/coord/relayBody.ts` (Task A1).** `parseRelayBody` and `parseNudgeBody`, first refusal in Table 3's order,
  a closed set of refusal words (`RELAY_BODY_WHYS`), and `relayBodyDetail`, the detail the door answers beside `bad-request`.
- **L1, `server/src/coord/relay.ts` (Tasks A2 and A3).** `relayVerdict` (Table 6, first match), `relayPriority` and
  `renderRelayBody`, with `isRelayKebab` for the coordination directory's kebab-token census.
- **L1, `server/src/coord/citedNames.ts` (Task A2).** `citedNamesOf`.
- **L1, `server/src/coord/overlaps.ts` (Task A2).** `relayFactsOf`.
- **Tests.** `relayCases.ts` holds every case once; `relay-body`, `relay-verdict`, `cited-names` and `relay-render` run them
  against the real modules, and `sim/relaySets.ts` against each mutant. The transitions test and the request cases gain the
  `relay-held` row in their independent tables, and the transitions test gains the relay vocabulary's cases.
- **Censuses.** `single-definition/relay-callers.test.ts` (point 6); the kebab-token census admits `isRelayKebab` (its holder's
  yes, mail 41212); the floors pair registers the seven deciders at floor 1 (its holder's yes, mail 41215).

## 3. The seven points of the brief, each with the case that goes red

1. **Pure and total, at floor 1, the order pinned.** Every function here takes its facts as arguments and reads no clock, file
   or database; `relay-callers` holds that the three modules write no log line. The verdict's rows carry Table 6's numbers in
   the source; the case "first match between each adjacent pair of rows" pins the order, and mutant V32 (rows 9 and 10 swapped)
   is killed by it. No two conditions a caller handles differently share an answer: a vanished row is `not-found`, a row
   outside a transaction `unavailable`, every unread fact `unavailable` with its own detail, and a refusal and a hold are two
   kinds of answer.
2. **Closed refusals, a literal rebuild, bounds once.** The parsers answer one word of `RELAY_BODY_WHYS` and a field from the
   body's own key list, never a key or a value the caller sent (the case "an unknown key is refused without naming it"). An
   accepted body is a `RelayBody` literal built field by field (the case "rebuilt as a new literal, never the caller's
   objects"; mutant P6 is killed by it). The bounds are `RELAY_BOUNDS` (the part, the why, the entries), `REQUEST_BOUNDS` (the
   paths) and `DONE_TEST_BOUNDS` (through `parseDoneTest`), each declared once.
3. **Two voices, never joined; text as data.** The operator's words are never in the body: their field lists the cited
   message ids, for the server to render at fetch (the coordinator's answer to my question: cited ids only, RL13 kept). The
   Overlord's part is the one free text, last, under its own label, inside `untrustedBlock`'s fence with a preface that names it
   the Overlord's call. Every other value is a server word, a number, or a JSON-quoted string on a line of its own. The case
   "hostile text cannot end a fence, forge the other field or carry an envelope line" renders a part holding fences, labels,
   `--` and envelope lines, a widening and a path holding line breaks, then runs the body through the real `renderEnvelope` and
   `parseMailEnvelope`: the sender stays `overlord`, the body comes back whole, and each label stands once outside the part.
   Mutants R6 (no quoting) and R8 (no fence) are killed by it.
4. **Names through the matcher only.** `citedNamesOf` builds entries with the matcher's `entryOf` and finds them with its
   `hitsAt` and `pairHits`; it holds no name list, and its names are its argument. Nothing here logs (`relay-callers`), and no
   refusal detail carries a name from the cited words.
5. **Three answers kept apart.** The facts carry the owner's liveness as `true`, `false` or `unmeasured`, its coordinator as
   named, none or unmeasured, the key as free, taken or not read, the pairs as read or failed, the cited messages' changed,
   missing and unread as three separate flags, and the names as `true`, `false` or `unmeasured`. The cases "row 6", "row 7",
   "row 8", "row 10" and "row 12" each split the arms; mutants V12, V14, V18, V20 and V24 fold them and are killed.
6. **Nothing reachable at merge.** `relay-callers.test.ts` holds that no `server/src` file but the relay's own imports
   `relayBody.ts`, `relay.ts` or `citedNames.ts`, and that nothing but the verdict calls `relayFactsOf`; its controls plant each
   violation. First callers: the relay door's facts and handler (Task A4) for `parseRelayBody`, `relayVerdict`, `citedNamesOf`,
   `renderRelayBody` and `relayPriority`; the nudge door (Task A5) for `parseNudgeBody`; the operator's requests read for
   `relayFactsOf` (with the verdict).
7. **The programme's design rule.** Everything here is the product's own: its request table, its deciders, its mail body and
   the matcher it already ships. Nothing depends on a surface only one agent harness has.

## 4. Departures, by slug

- **`relay-keys-wait-for-act-rows`** (the brief's item 1): `relayNaturalKey` and `nudgeNaturalKey` are not here; the verdict
  reads only whether the door found the key taken (row 8).
- **`relay-answer-type-with-its-door`**: the plan puts `RelayAnswer` in L0 with Task A1. It is the door's answer, built on act
  rows A's `ActAnswer`, which is not on `main`; it comes with Task A4.
- **`relay-bounds-one-object`**: the plan names four constants (`RELAY_PART_MAX` and others). The relay's own bounds are one
  object, `RELAY_BOUNDS`, as `REQUEST_BOUNDS` is; the expected paths read `REQUEST_BOUNDS` (RQ16) rather than a second copy.
- **`relay-door-facts-keep-three-answers`**: the plan's `RelayDoorFacts` is a sketch. Here the owner's liveness is a
  `Fact<boolean>`, its coordinator three kinds, the key three kinds, the cited messages three flags, and the move plan's answer
  is `{ ok: true }` or the word it refused with (an L1 file cannot import the L3 store's type). `rootId` goes with the natural
  key, and the row's expected paths are a fact, read when the body names none.
- **`relay-verdict-unread-rows`**: rows the table does not spell, each for a fact that can fail: `no-owner`, `programme-unmeasured`,
  `coordinator-unmeasured`, `key-unread` and `not-in-transaction`, each `unavailable` or `bad-transition` with its own detail;
  a row that vanished between the read and the plan is `not-found`.
- **`unread-names-hold-unchecked`**: row 13 with the names unread holds `quote-unchecked`, never `unnamed-widening` (the plan's
  "never holds `unnamed-widening`" names what it is not; this names what it is).
- **`ruled-pair-carries-its-side`**: a go carries the ruled pair's choice, the owner's side and the other programme's slug; the
  door turns the slug into an id before rendering, and the rendering names the owner's side "this programme" and the other
  `programme #<id>`.
- **`operator-words-by-id`** (the coordinator's answer to my question): the body's operator's-words field lists the cited message
  ids; the words are rendered at fetch (RL13).
- **`part-in-the-untrusted-block`**: the part renders through `untrustedBlock` with a preface of its own, not a new fence.
- **`body-cap-counts-the-paths`**: 32 paths of 512 bytes do not fit the 8 KiB body beside a full part. The paths are listed
  while the body fits, and a last line counts the rest "on the request".
- **`cited-names-under-their-own-key`**: the plan builds the entries under the public salt. Under that salt the matcher caches
  the text of every window it hashes, per process and without bound, and here those windows are the operator's words. The
  entries are built under a key of their own, which keeps no text and changes no match. `citedNamesOf` also clears the
  matcher's pair read, which keeps the last line it read.
- **`cited-names-span-whitespace`**: a name of two or more tokens is matched `exact` and as `words`, so a slug written across a
  line break (the plan's own case) or with a space is named.
- **`body-text-refuses-controls`**: the part and the why may hold a line break and a tab and no other control, line-separator or
  bidirectional-format character; a project and a path are one line, so they take neither.
- **`project-bounded-as-a-path`**: the request record bounds a path, not a project. A project string is held to the path's
  512 bytes, and must be non-empty and one line.
- **`re-relay-widens-false-passes`**: `widens: false` on a re-relay is accepted as no widening; only `true` refuses.
- **`ids-are-a-type`**: a request id that is not a positive safe integer, and a revision that is not a non-negative one, are
  `wrong-type`, not a bound.
- **`relay-held-in-the-request-cases`**: the request cases' independent table gains the row (`requestCases.ts`, claimed here).
- **Process.** (a) The implementation was written before its tests in this session, against the brief's "test-first"; every
  case was then measured against the mutants (all killed) and the plan's by-hand F5 mutation. (b) A claim beside a live claim
  is refused (409), so the three held files carry the holders' yes (mails 41208, 41212 and 41215) and no claim of mine. (c) The
  Write tool stored `\uXXXX` escapes of code points above 0x7F as the raw characters, which broke a regular expression;
  every such escape was rewritten as `\u{XXXX}` with the Edit tool, and the files hold no raw control character (measured).

## 5. Mutation rows

Every set runs against `relayCases.ts` through the floors' own runner; every mutant is killed (score 1).

| Decider | Mutants | Before | After |
|---|---|---|---|
| `relayBody.ts#parseRelayBody` | 22 | not registered | 1 |
| `relayBody.ts#parseNudgeBody` | 5 | not registered | 1 |
| `relay.ts#relayVerdict` | 36 | not registered | 1 |
| `relay.ts#renderRelayBody` | 14 | not registered | 1 |
| `relay.ts#relayPriority` | 4 | not registered | 1 |
| `citedNames.ts#citedNamesOf` | 8 | not registered | 1 |
| `overlaps.ts#relayFactsOf` | 3 | not registered | 1 |

The plan's least counts (§12) are met: `relayVerdict` 20, `parseRelayBody` 8, `renderRelayBody` 4, `relayPriority` 3,
`relayFactsOf` 2, `citedNamesOf` 5. By hand (Task A1 Step 4): `routed` added to `relay-held`'s from-states reds two cases of
the transitions test (its row case and the F5 case); restored, `git diff` empty. The other three by-hand mutations of that step
are mutants P1, P2 and P3.

## 6. What the doors of the later parts read

| Reader | What it reads |
|---|---|
| The relay door (Task A4) | `parseRelayBody` and `relayBodyDetail`; `relayVerdict` with facts from `relayFactsInTx`; `citedNamesOf` over the cited texts whose hash matches; `relayPriority` over `portfolioOrder` and the readable rank classes; `renderRelayBody`, after turning the ruled pair's other slug into its id; `RELAY_HOLD_REASONS` for the `relay-held` move |
| The nudge door (Task A5) | `parseNudgeBody`, `relayPriority`, `renderRelayBody` with `kind: 'nudge'` |
| PR B | The verdict's `widensGate` input (row 14) and the hold reason `quote-private-name` |
| The requests read (`blockedBy`) | `relayFactsOf` |
| Home requests B, W5's start door | `citedNamesOf` |

## 7. Known limits

- **One ruled pair.** When several ruled pairs let a relay through, the go names the first in `blockingPairs`' order only.
- **The tests' type check.** Run whole through the fleet test wrapper, it was killed twice by the test slice's 6 GB memory cap
  while other heavy runs held the slice. A narrower project over this part's test files and what they import (with the same
  compiler options) is clean, after it found one fixture word misspelt; the pull request's typecheck job is the arbiter of the
  whole.
- **Two floors that cannot run on the test box.** The console's mood sets fail at their baseline there (`@ccrc/ui` is not
  installed in its checkout); they touch nothing of this part.
- **The ranks the priority reads** are the door's to build from the readable rank rows, as `portfolioOrder` reads them.
