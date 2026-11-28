# W2 act journal, PR A: task note

The task note of plan [`w2-act-journal.md`](../../plans/2026-11-16-overlord-w2/w2-act-journal.md), PR A (Tasks A1 to A4): the act
journal's grammar, its fold and its census rows; the writer, its head row, the torn-tail heal and the snapshot pin; the daily
signed head, its table, its lane, the digest line, the head read and the console's line; and one doctor check over both Overlord
journals. The coordinator folds this note into the programme ledger; this pull request edits no plan, spec or ledger. No
deviation number was issued: every departure is named by slug (§4).

The work ran in three stages, by the coordinator's brief and its calls 2007 and 2023: stage 1 on `main` alone (Task A1, Task A4
and Task A3's pure parts); a middle stage, still on `main` (the guard's second argument, Task A2's writer against an interim copy
of the act store's port, the rest of Task A3, the migration); and the last stage after act rows A's first pull request (#3664)
landed: one merge of `main`, the interim block replaced by imports, and the push. Everything before the last stage was committed
locally and pushed with it.

## 1. Step 0: what `main` held, measured against the plan

The plan is a snapshot of 2026-11-16 (`main` at `b779a9c20`). The first two stages measured `main` at `ac09ad60da`:

| The plan says | `main` holds | What this PR did |
|---|---|---|
| The record type and the port are act rows A's (`ActJournalRecord`, `ActJournalPort`) | Not on `main` before the last stage: #3664's (`server/src/coord/overlordActs.ts`, `overlordActsStore.ts`), with the act states, the natural key's target kinds and the target list's kinds in its own L0 file (`shared/overlordActs.ts`) | The first stages wrote against one typed interim block in `overlordActRecords.ts` (the type, its three word lists and the port with its answer; call 2007, Q2; call 2023). The port's ok answer carries a sequence number, as the plan declares (#3664's fix round, the coordinator's 41354). Last stage: (fill in) |
| The verified-head cache ships first, in the adapter (F16) | On `main` (`chainedJournalFile.ts`, `verifiedHeadHolds`) | Used as it is |
| `shared-user` is the isolation piece's word, not built | Built: `shared/isolation.ts` (`ISOLATION_WORDS`, `IsolationRead`), read through `deps.isolation` | The grammar's `isolation` field and the sign verdict read it |
| The shipped tree carries `server/dist/` beside `deploy/` (question 9, Task A4 Step 1) | Yes: `deploy/build-release.sh` stages `server/dist` with the tracked `deploy/` | The helper stays in `deploy/`, importing `../server/dist/server/src/` |
| `ApprovalSigner` has `signRuling` and `publicKeyPem` | As written; the signer is loaded lazily in the coordination routes | Gains `signActHead` (question 7); the lane loads the same key through the same module, once, on first use |
| `CCRC_DOCTOR_CHECKS` and the doctor's verdict helpers | As written; the array's lines are cited by number elsewhere | The check's name joins an existing array line, so no cited line moves |
| `MIGRATIONS` | 135 entries | One migration at the next free slot, 136 when written; three other open pieces take the same slot, so the second to land renumbers (§2, point 6) |
| `DigestAnswer` and the digest view | In `shared/api.ts`, which the brief keeps out of this PR | The digest's head line rides `DigestAnswer & DigestActHead`, declared in `shared/actJournalHead.ts` |

## 2. The coordinator's nine points

1. **One writer of the journal file and of each head row.** The file: `OverlordActJournal`, one instance, built once in
   `server/src/index.ts` (the callers census's `CHAINED_BINDERS` names its module, and `CUT_CALLS` its one heal). The head row:
   `overlordActJournal.ts#writeActHeadRow`, the append step's after the last record and before the caller's apply (act journal B
   adds Confirm's adopt). The signed heads: `overlordActHeadStore.ts#recordActHeadInTx`. Both are in `writers-map.test.ts`.
   **The order** is the authority journal's (`appendThenApply`): decide (the guard, then Table 7.6a over the file and the head row,
   then each settle's `from` against the fold), append and fsync every record, write the head row, run the caller's apply (the act
   row and its line), and the caller commits. **What a crash between them leaves:** one or two records past the head row and no act
   row, since the transaction never committed. No reader takes them for an act. A torn partial line is cut aside at the next boot
   (`healTornTail`, only behind a sound prefix whose last record is the head row). The complete records read `trailing` (or
   `ahead`) to boot coherence, which act journal B's boot arm refuses on and Confirm the restore heals by adopting the file's
   verified head (F3). A failure at or after the first append inside the call (a port that fails at open, write or fsync; a
   record past the first that finds the file moved; a throw from the apply) tells the guard `trailing` for the act journal at once.
2. **Ids, words, hashes and times only.** The grammar admits only ids, counts, words of closed lists and hex; the one text a
   record holds is the actor's subject, as the row and the sequence line carry it (call 2007). No refusal the grammar or the writer
   throws or answers echoes a value: a kind or a key is named only when it is a kebab word, and the writer's details name verdict
   words and counts. Planted-marker cases: every string field of every kind, the kind and an unknown key's name refuse the marker
   without echoing it; a marker in an operator subject is in the record's actor field and nowhere else in its bytes; the doctor
   helper's lines and the doctor's lines never carry it, on a verified journal and on a broken one. The head holds a day, a sequence,
   a journal id and a digest; its digest line, its read and the lane's warn line hold those, a signature, a closed unsigned word and
   a verdict word.
3. **Three answers, never folded.** `actJournalHighest` answers `measured`, `absent` or `unmeasured`; the helper answers `absent`,
   `ok`, `torn-tail`, `malformed` or `unreadable` per journal and the doctor grades a missing build or an unreadable answer as
   unmeasured, never PASS; `digestAtSequence` answers a digest, `absent` or `unmeasured`; the head read answers 503 when its table
   cannot be read; the digest's `actHead` is a head, absent, or `unmeasured`; `headExtends` and the console's check answer
   `unmeasured` for an unreadable record or an input out of shape.
4. **The guard's failure call gains a second argument.** Characterised first, green on `main`'s code (`dc530f35e7`: today's
   `writerFailed(cause)` from every state as exact objects, and the restore latch's detail), then changed in a commit of its own
   (`78d1d9f03c`): `writerFailed(cause, journal?: 'acts')`, an optional `journal` on the guard's non-coherent states, and the gate's
   step 3 and the restore latch naming the act journal through `journalNameOf`. A call without it moves to exactly the state it
   always did.
5. **The head read is one new route**, `GET /api/overlord/act-head?at=<sequence>`, in `coord/overlordRoutes.ts`, session-gated,
   no box token, no step-up. Its census lines, derived on `main` at `ac09ad60da`: the auth gate's scanned routes 345 -> 346, its
   HTTP half 342 -> 343, the gated count 222 -> 223, the exempt count stays 120 (the suite and `gate.ts`'s docstring); the box-token
   census's `OVERLORD_OPERATOR_DOORS` gains it and its count 18 -> 19; the mask census lists it EXEMPT with its reason (slug
   `act-head-read-is-exempt`); `CLAUDE.md`'s sentence of session-gated Overlord reads names it. Re-derived at the last merge.
6. **One coordination-database migration**, both tables, at slot 136 when written: `overlord_act_journal_head` and
   `overlord_act_heads`. Its pins: the coordination database's two version pins and a comment, and the two undo lists (the run-close
   switch's and the limit samples store's). **This PR carries a migration**, at the same slot as request ids A, act rows A (#3664)
   and the label queue; the second to land renumbers this one entry and those pins.
7. **The lane rides the lane schedule's table:** `actHeadSign` (hourly, `startsDue`, monotonic, `ACT_HEAD_SIGN_BEAT_MS` beside the
   digest's beat), run by the watcher's `sweepActHeadSign` beside `sweepDigest`; no timer of its own. With no act written (every box
   at merge) a pass reads today's row, finds no record, writes nothing and logs nothing; the head read answers `head: 'absent'`; the
   digest has no `actHead` field and draws no line. Pinned: the lane plan's `no-record` case, the lane pass's "no record writes
   nothing and logs nothing" case, the head read's "before any head" case and the digest line's "no field" case.
8. **The doctor file's growth:** +30 code lines by the repo's own counter, within 40. The other growth-checked files: `schema.ts`
   +10, `server.ts` +4, `watch.ts` +5, `pwa/src/lib/api.ts` +3.
9. **The programme's design rule.** Everything here is the product's own: its journal file, its kernel, its server build's file
   adapter run by a Node helper, its doctor, its signing key, its lane table and its console. Nothing depends on a surface one agent
   harness has.

## 3. What was built

- **L1, `server/src/coord/overlordActRecords.ts` (Task A1).** `OVERLORD_ACTS_BASENAME`, `OVERLORD_ACTS_TORN_DIR`, the three
  record kinds, `OverlordActRecordError` and `OverlordActJsonError`, `OVERLORD_ACTS_FORMAT`, `actRecordEntry` (the grammar),
  `canonicalActRecord`, `actJournalFold`, `actJournalHighest` and `isOverlordActsKebab`.
- **L3, `server/src/coord/overlordActJournal.ts` (Task A2).** `overlordActsFileAt`, `OverlordActJournal` (`appendInTx` on Table 2,
  `readVerified`, `readHighest`, `readHeadRow`, `measure`, `healTornTail`), reusing `authorityCoherence` and `authorityTailHeal`
  (generic over the entry) rather than a second decider.
- **The guard** (`overlordAuthorityGuard.ts`, `overlordAuthorityJournal.ts`'s port, `overlordAuthorityCoherence.ts`): point 4.
- **Task A3.** `shared/actJournalHead.ts` (L0): `ACT_HEAD_DOMAIN`, `actHeadPreimage`, `isActHead`, `headExtends`, and the wire
  types `ActHeadReadWire`, `ActHeadRecorded`, `DigestActHead`. `overlordActHead.ts` (L1): `actHeadSignVerdict`, `actHeadLanePlan`,
  `digestAtSequence`. `overlordActHeadStore.ts` (L3): the signed heads' one writer and reads. `overlordActHeadLane.ts` (L4): the lane's
  pass and the head read's answer. `ApprovalSigner.signActHead`. The route, the lane row, the watcher's sweep, `deps.actHead`, the
  digest's field and the root's wiring. The console: `actHeadWords.ts` (L1, the line and the digest's line), `actHeadCheck.ts` (L1,
  the check over ports), `useActHead.ts` (L4, the ports bound to the API, `lib/storage.ts` and WebCrypto), `ActHeadLine.tsx` in the
  Overlord place beside the readiness part, and one line in the digest screen.
- **Task A4.** `deploy/overlord-journals-verify.mjs`; `_check_overlord-journals`; `HEALTHY_SKIPS` raised by one and
  `FLEET_BOX_CLASSES` gains its row, each measured.
- **Censuses.** The kinds census's fifth row; `isOverlordActsKebab` and `isActHeadKebab` in the kebab census; six mutant sets at
  floor 1; the callers census; the snapshot pin (the act journal's file, torn directory and stem in `NAMES`, planted in both
  fixtures); the writers map; the coordination handle list; the gate, box-token, mask and lane censuses (point 5, point 7). Every
  file another worker held was changed only after its holder answered yes to the exact diff (§6).

## 4. Departures, by slug

- **`act-record-kinds-are-prefixed`** (the plan's own, question 1): `act-intent`, `act-settle`, `act-open-request`.
- **`actor-subject-as-the-row-carries-it`**: call 2007, correcting the brief's point 2; checked by `readActorColumns` and each
  kind's shape (a session id by `isSessionIdShape`, the server's lane form, an operator's opaque text within `ACTOR_SUBJECT_MAX`).
- **`authority-checked-by-shape`**: `authority` is a word or a word and an id (`own`, `delegated`, `ruling:R<n>`,
  `operator-request:<n>`, `operator-command:<n>`, `grant:<n>`, `autonomy:<n>`, `entry:<n>`).
- **`isolation-held-as-word-or-reason`**: a measured word, `unmeasured`, or `unmeasured:<reason>`.
- **`request-floor-reads-every-request-id`**: the fold's highest request id reads every request id a record names.
- **`highest-act-id-reader`**: `actJournalHighest`, for the writer's journal-highest argument on every write (the review of #3664).
- **`head-preimage-in-l0`**: one builder in `shared/actJournalHead.ts`, read by the signer and the console, checked against
  `rfc8785Json`.
- **`approvals-disabled-asked-first`**, and **`key-unavailable-word`**: the sign verdict asks the operator's switch first, then the
  isolation word, then whether the key loaded; a key that cannot be loaded records the head unsigned with `key-unavailable`, a
  fourth word beside the plan's three.
- **`head-verdict-and-store-in-two-modules`**, and **`head-lane-runner-in-its-own-module`**: the verdict and the lane plan (L1)
  in `overlordActHead.ts`, the table's SQL in `overlordActHeadStore.ts` (L3), the pass and the read's gathering in
  `overlordActHeadLane.ts` (L4).
- **`act-head-read-is-exempt`**: the plan has the head read masked; its answer is a signature, a public key and hashes the console
  checks byte for byte and holds no session-written text, so it is EXEMPT with that reason in the mask census, not in
  `MASKED_GET_ROUTES`.
- **`digest-field-rides-an-intersection`**: the digest's head line is `DigestAnswer & DigestActHead`, so `shared/api.ts` is not
  touched (the brief's seam), and the route composes it rather than `buildDigest`.
- **`console-check-over-ports`**: the plan's `pwa/src/lib/actHead.ts` is `overlord/actHeadCheck.ts` (L1, over ports) and
  `overlord/useActHead.ts` (L4), the kept head going through `lib/storage.ts`, the page storage's one owner.
- **`boot-verdict-journal-with-pr-b`**: the guard's `bootVerdict` gains its journal in act journal B, whose Task B2 keeps a verdict
  per journal; PR A adds it to `writerFailed` only.
- **`port-open-failure-is-trailing`**: a port that fails to open the file for its append counts as past the append, as the authority
  journal's row 8 treats it (the adapter's `mayApply`), so it fences as `trailing`.
- **`bad-records-answer-journal-append`**: records the grammar refuses, or none, answer `journal-append` before anything is read or
  written, and the guard is not told; the port has no word for a caller's error.
- **`no-helper-skips`**: a tree that ships no doctor helper SKIPs, as `sigstore-root` does with no verifier.
- **`doctor-suite-sources-the-check`**: the doctor suite sources `ccd/ccrc` and the checks file in a fixture HOME, as
  `approvals-doctor.test.ts` does, rather than through `makeCcdHarness`; it runs no `ccd`.
- **Process.** Two slips against the brief, both corrected: an edit of the doctor file before its holder answered (reverted at
  once and redone as a packet, applied only on the yes), and one rename in `overlordActHeadLane.ts` made with a stream edit rather
  than the Edit tool (its content is as committed and was reviewed in the diff).

## 5. Mutation rows

| Decider | Before (`main`) | After |
|---|---|---|
| `server/src/coord/overlordActRecords.ts#actRecordEntry` | new | 21 of 21 killed |
| `server/src/coord/overlordActRecords.ts#actJournalFold` | new | 9 of 9 (one survivor found and killed by a new case) |
| `server/src/coord/overlordActRecords.ts#actJournalHighest` | new | 4 of 4 |
| `server/src/coord/overlordActHead.ts#actHeadSignVerdict` | new | 7 of 7 |
| `server/src/coord/overlordActHead.ts#actHeadLanePlan` | new | 5 of 5 |
| `shared/actJournalHead.ts#headExtends` | new | 9 of 9 |

By hand, each run against its suite and reverted (in a scratch copy, never the tree): the writer's head row before the append
(17 cases red), the append outside a transaction (1), the heal's cut without the sound-prefix check (1), the `from` check skipped
(2), the apply before the head row (3), a failure after the append not told to the guard (1); the doctor check's six (torn tail
PASS 3, fleet skip dropped 1, malformed WARN 5, line count dropped 1 after a new case, unmeasured PASS 1, missing helper arm 1),
one more removed as redundant.

## 6. Held files

Each was changed only after its holder answered yes to the exact diff, by size and SHA-256: the kinds census and the floors pair
(chat B's worker), the kebab census (label queue A's), the doctor file (docs artifacts follow-up's, twice), and in the middle stage
the migration and its pins (request ids A's), the coordination handle list and the server file (act rows A's), the Overlord routes,
the root and the floors (chat B's), the lane schedule, the watcher, the deps, `gate.ts` and the gate, box-token, mask and lane
censuses (label queue A's), and `CLAUDE.md` (overlord-v1's).

What the holders measured for whoever lands second: the migration's slot, its pins and the limit store's undo count meet request
ids A's (also at 136, with its three columns and an index), act rows A's and the label queue's; the gate's counts with the label
queue's two doors and one lane read 348 scanned, 345 HTTP, 225 gated, 120 exempt and 68 monotonic; the coordination handle list
keeps act rows A's entries and comment beside these, closed once; the root keeps chat B's reply boot block after
`deps.responseStamp`, with the act head block before that line. Each lander keeps every side's added lines and removes none.

## 7. What PR B and the request doors read

- **Act journal B:** `OverlordActJournal.measure` (Table 7.6a over the head row) for its boot arm; `readVerified` and
  `actJournalFold` for the reconciliation pass; `readHighest` and `requestFloor` (the head row's column, written by nobody in PR A);
  the guard's `journal` for `bootVerdict`; `digestAtSequence` and the signed heads for the witness.
- **Act rows A's store:** the port this writer implements, and `readHighest().act` as `nextActId`'s second argument on every write.
- **The request doors (request record B):** the writer's records for `opens`, and the request floor through the journal.

## 8. Known limits

1. **The record holds the operator's device label**, as the row and the sequence line do (call 2007).
2. **No production caller appends yet**: the writer is wired at the root (the boot heal, the lane, the head read), and its first
   appender is act rows A's store when its writers gain a caller.
3. **The doctor helper needs the server build** beside `deploy/`; a tree without it answers unmeasured (WARN).
4. **The scratch runs of this branch's held-file changes** fell back to the loaded local box (the test box serves the worktree), so
   some long cases timed out there (two coordination database cases, two drawer cases); the same cases were run in the worktree
   once each holder answered.
5. **The fleet-box class case** could not arbitrate on this box (an environmental `browser-mcp` WARN, the same on `main`); the new
   row was measured with that one key set aside, scratch only.
