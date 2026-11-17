# Overlord W2 remaining work, PR A: notes

These are the notes for PR A of `w2-remaining-work.md` (Tasks 1 to 3). They hold what the ledger should learn: departures
by slug, measurements and what is left for landing. The coordinator folds them into the ledger and mints any numbers.

## In short

- **Built as the plan says:** the vocabulary and wire in `shared/programmeFacts.ts` (its own headed block, beside the
  overlaps block to come); `remainingBodyOf` (L1); `programme_remaining` and `programme_edges` with one writer,
  `insertRemaining`; the door `POST /api/coord/programmes/:slug/remaining` in the call record door's order; every census
  site of a new lane source; `ccrc-api programme remaining`; the wave-boundary reference paragraph.
- **Live at merge.** The door needs the box token, attribution and ownership. Nothing reads the two tables yet but the
  tests. `EDGE_CLEARING_SHIPPED` is `false`.
- **Migration slot.** It is entry 86 by position on this branch after a third merge of `main` (the coordinator's word,
  2026-11-17): portfolio B (#2904) landed 83, responses B (#2914) 84 and overlaps A (#2949) 85. Other open PRs hold 86 too;
  whoever lands second renumbers at landing, on the coordinator's word.

## Departures, by slug

| Slug | What the plan says | What was built, and why |
|---|---|---|
| `edge-target-verdict-in-l1` | `edgeTargetCheck(db, slug, target)` in the store decides a target | The store reads the target's row (`edgeTargetFacts`), and the rule is `programmeRemaining.ts#edgeTargetVerdict`, an L1 decider: decide in L1. `edgeTargetCheck` keeps its name as the store's read plus the verdict. The verdict joins `MUTANT_SETS` at floor 1 (six mutants, all killed). |
| `edge-unreadable-kind-and-target-carried-as-null` | An unknown `kind` row carries `kindUnreadable: true` | `ProgrammeEdge.kind` and `.target` are null only when unreadable, each with its flag (`kindUnreadable`, `targetUnreadable`). A stored target this build cannot read (a newer build's shape) is carried, never dropped and never a throw. |
| `operator-confirms-open-is-waiting` | "an open item" | "Open" is `shared/ledgers.ts#OPEN_ITEM_STATES` (`open`, `checking`), the ledger's own list of states an item still waits in. |
| `pr-merged-target-any-run` | A `pr-merged` target names a run whose lineage lists the PR | Built as written: the run may be of any programme, this one included. Only `run-closed` requires another programme's run. |
| `remaining-runid-null-refused` | `runId` "present and not a positive safe integer" | Only an absent `runId` means "at the plan"; a JSON `null` is refused, as `callBodyOf` refuses it. `edges: null` is refused the same way. |
| `edges-by-program-index` | The schema lists one partial unique index | A second index, `programme_edges_by_program (program, state)`, serves `openEdgesOf` and the open-edge count. |
| `reference-paragraph-names-the-shapes` | Two sentences and the example | The paragraph also names the three edge shapes and says only the server clears an edge, so a coordinator can write an edge from the reference alone. |
| `claude-md-names-file-lanes` | Drop the `CLAUDE.md` sentence: `box-token-census.test.ts` reds | No check tied a lane in a file of its own to the bullet, so one was added: the bullet must name every lane of the call record's and the remaining-work door's files. It reds when either sentence is dropped. |
| `route-files-word-corrected` | `auth-gate.test.ts`: the count of files that register routes | Its header said THIRTEEN while `ROUTES` scans nineteen files; it now says TWENTY, the measured count with this door. |
| `remaining-refusal-declared-in-l0` | The store answers `too-many-open-edges` | The word is declared once in `shared/programmeFacts.ts` (`RemainingRefusal`, `REMAINING_REFUSALS`, `isRemainingRefusal`), the edge predicates gain `isEdgePredicate`, and `mail-routes.test.ts`'s census of kebab tokens in `server/src/coord` admits both through those guards; the first full CI run found them undeclared. Dropping the census line reds it. |
| `edge-unmeasurable-is-its-own-fact` | `EDGE_UNMEASURABLE_AFTER_MS` is 7 days | The coordinator ruled it a different fact that only shares the number (review 2347, F3): how long an edge's target may stay unmeasured before the edge stops blocking. It is not one of `token-shared.test.ts`'s seven-day holders, which stay seventeen; the census names it in a row of its own (`OWN_FACTS`), and dropping that row reds the holders case. Its comment in `shared/programmeFacts.ts` says what it measures and why seven days (the plan's ruled question 3). |

## Measured

- **Growth** (net code lines against `b99bc6390`): `schema.ts` +15, `store.ts` +5, `routes.ts` +2, `server.ts` 0. The
  plan estimated +26, +5 and +4.
- **Mutation floors:** `remainingBodyOf` (ten mutants) and `edgeTargetVerdict` (six mutants), every mutant killed.
- **Red checks** (each applied to the file, the named suite run, and the file restored from a saved copy):
  - Task 2: an `UPDATE programme_remaining` in the writer reds `writers-map.test.ts`; dropping the kept branch reds the
    kept and cap cases; reading an unknown state as `met` reds the guard case.
  - Task 3: skipping the ownership check reds the worker case; dropping the `EXEMPT` row reds `auth-gate.test.ts`;
    dropping the `CLAUDE.md` sentence reds `box-token-census.test.ts`; dropping `program = slug` reds the F6 case;
    filling the pane's pair with `splice_body_field` reds `ccrc-api-closed.test.ts`'s append-last census.

## Review 2347, fix round

- **F3:** the holder ruling above (`edge-unmeasurable-is-its-own-fact`).
- **F4:** `writers-map.test.ts`'s append-only case now reads `UPDATE`, `DELETE`, `REPLACE INTO`, `INSERT OR REPLACE` and an
  `INSERT` whose `ON CONFLICT` does an `UPDATE` on `programme_remaining`, with a CONTROL row for each, and a new case pins
  that `insertRemaining` never changes or removes an edge. Measured red, each applied to `programmeFactsStore.ts` and the
  file restored from a saved copy: an `UPDATE programme_edges` in the writer, an upsert of `programme_edges` in it, an
  `INSERT OR REPLACE INTO programme_remaining` and an upsert of `programme_remaining`.
- **F7:** `auth-gate.test.ts` names the remaining-work door's file the twentieth, matching its header.
- **F8:** `README.md`'s lane paragraph names both programme doors, the call record's (missing before) and this one. A
  hunk beyond the landing-order holder's consent below, made on the coordinator's ruling.
- **F1, F5, F6, F9:** no action, as ruled.

## For later pieces

- **An unknown stored state word in the writer's reads (review 2347, F2; carried into PR B).** `edgeOf` reads an unknown
  state word as `open` with `stateUnreadable`, but `insertRemaining`'s keep lookup, its open-edge count and the partial
  unique index `programme_edges_one_open` read only the literal `'open'`. Nothing writes another state word in PR A, so
  this is unreachable now. When PR B's `settleEdge` writes a second state, an unknown stored word must count as open in
  the keep lookup, the cap count and the index, as `edgeOf` already reads it.

## For landing

- **Peers who agreed co-edits.** Responses B (`schema.ts`, `coord-db.test.ts`, `run-close-switch.test.ts`,
  `time-ports.test.ts`), portfolio B (`store.ts`, `writers-map.test.ts`, the mutation floors, `gate.ts`, the box-token
  census, `auth-gate.test.ts`, `CLAUDE.md`, `ccd/ccrc-api`, `ccrc-api.test.ts`), designation A (`core-vocab.test.ts`),
  hand-offs (`fastify-l4.data.ts`, `coord-routes-single-file.test.ts`) and overlaps A (`shared/programmeFacts.ts`, one
  headed block each). Whoever lands second merges `main` once and keeps both sides.
- **The landing-order holder's consent is narrow.** It covers exactly two hunks of `server/src/coord/routes.ts` (the
  import and the registration beside the call record's) and, in `README.md`, `eighty-five` to `eighty-six` at
  `b99bc6390`. A recount at landing (another lane landing first) needs that holder's fresh consent for the new words.
- **Counts re-derived after the third merge of `main`** (route 251 behind responses B's 250; HTTP 248, gated 152, exempt
  95, unchanged by overlaps A, which adds no route; `user_version` 86; `run-close-switch.test.ts` replays thirty-three;
  `shared/programmeFacts.ts` holds overlaps A's block and this PR's, each under its own head; `token-shared.test.ts`'s seven-day holders stay
  seventeen, with `EDGE_UNMEASURABLE_AFTER_MS` in its own row; the lane words and the `ccrc-api` rows unchanged,
  since responses B's doors are session-gated and add no client row). **To re-derive again if another lands first:** the migration slot and `coord-db.test.ts`'s two pins, the undo step's
  count word in `run-close-switch.test.ts`, `ROUTES.length` and the HTTP, gated and exempt counts in `auth-gate.test.ts`,
  the route count in `gate.ts`'s header, the machine-lane words in `gate.ts`, `README.md` and `box-token-census.test.ts`,
  and the `ccrc-api` row count (three sites).
