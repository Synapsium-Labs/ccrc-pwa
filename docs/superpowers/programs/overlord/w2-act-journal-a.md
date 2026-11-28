# W2 act journal, PR A: task note

The task note of plan [`w2-act-journal.md`](../../plans/2026-11-16-overlord-w2/w2-act-journal.md), PR A (Tasks A1 to A4): the act
journal's grammar, its fold and its census rows; the writer, its head row, the torn-tail heal and the snapshot pin; the daily
signed head, its table, its lane, the digest line, the head read and the console's line; and one doctor check over both Overlord
journals. The coordinator folds this note into the programme ledger; this pull request edits no plan, spec or ledger. No
deviation number was issued: every departure is named by slug (§4).

The work ran in two stages, by the coordinator's brief: stage 1 on `main` alone (Task A1, Task A4, and Task A3's pure parts),
committed locally and pushed with stage 2, after act rows A's first pull request (#3664) landed with the store's port and record
type. Stage 2's sections are marked as such.

## 1. Step 0: what `main` held, measured against the plan

The plan is a snapshot of 2026-11-16 (`main` at `b779a9c20`). Stage 1 measured `main` at `ac09ad60da`:

| The plan says | `main` holds | What this PR did |
|---|---|---|
| The record type is act rows A's `ActJournalRecord`, aliased | Not on `main` in stage 1: it is #3664's (`server/src/coord/overlordActs.ts`), with the act states, the natural key's target kinds and the target list's kinds in its own L0 file (`shared/overlordActs.ts`) | Stage 1 wrote against one typed interim block in `overlordActRecords.ts` (the type and its three word lists, marked interim; the coordinator's call 2007, Q2). Stage 2: (fill in) |
| The verified-head cache ships first, in the adapter (F16) | On `main` (`chainedJournalFile.ts`, `verifiedHeadHolds`) | Used as it is; Task A2's measurement is stage 2's |
| `shared-user` is the isolation piece's word, not built | Built: `shared/isolation.ts` (`ISOLATION_WORDS`, `IsolationRead`) | The grammar's `isolation` field and the sign verdict read it |
| The shipped tree carries `server/dist/` beside `deploy/` (question 9, Task A4 Step 1) | Yes: `deploy/build-release.sh` stages `server/dist` with the tracked `deploy/` | The helper stays in `deploy/`, importing `../server/dist/server/src/` |
| `ApprovalSigner` has `signRuling` and `publicKeyPem` | As written | Gains `signActHead` (question 7) |
| `CCRC_DOCTOR_CHECKS` and the doctor's verdict helpers | As written; the array's lines are cited by number elsewhere | The check's name joins an existing array line, so no cited line moves |

## 2. The coordinator's nine points

1. **One writer of the journal file and of each head row.** Stage 2 (Task A2).
2. **Ids, words, hashes and times only.** The grammar admits only ids, counts, words of closed lists and hex; the one text a
   record holds is the actor's subject, as the row and the sequence line carry it (call 2007). No refusal the grammar throws
   echoes a value: a kind or a key is named only when it is a kebab word. Planted-marker cases: every string field of every kind,
   the kind and an unknown key's name refuse the marker without echoing it; a marker in an operator subject is in the record's
   actor field and nowhere else in its bytes; the doctor helper's lines and the doctor's lines never carry it, on a verified
   journal and on a broken one. The head, its digest line and the head read are stage 2's.
3. **Three answers, never folded.** `actJournalHighest` answers `measured`, `absent` or `unmeasured` (a malformed or unreadable
   file is never "no acts"); the helper answers `absent`, `ok`, `torn-tail`, `malformed` or `unreadable` per journal and the
   doctor grades a missing build or an unreadable answer as unmeasured, never PASS; `headExtends` answers `unmeasured` for an
   unreadable record or an input out of shape.
4. **The guard's failure call gains a second argument.** Stage 2.
5. **The head read is one new route.** Stage 2.
6. **One coordination-database migration.** Stage 2.
7. **The lane rides the lane schedule's table.** Stage 2.
8. **The doctor file's growth.** +30 code lines by the repo's own counter (`server/test/growthCheck.ts#codeLines`), within the
   40-line limit.
9. **The programme's design rule.** Everything here is the product's own: its journal file, its kernel, its server build's file
   adapter run by a Node helper, its doctor, its signing key and its console. Nothing depends on a surface one agent harness has.

## 3. What was built

- **L1, `server/src/coord/overlordActRecords.ts` (Task A1).** `OVERLORD_ACTS_BASENAME`, `OVERLORD_ACTS_TORN_DIR`, the three
  record kinds, `OverlordActRecordError` and `OverlordActJsonError`, `OVERLORD_ACTS_FORMAT`, `actRecordEntry` (the grammar),
  `canonicalActRecord` (targets sorted, keys in the grammar's order), `actJournalFold`, `actJournalHighest` and
  `isOverlordActsKebab`.
- **Censuses (Task A1).** The fifth row of `chained-journal-formats.test.ts#FORMATS`; `isOverlordActsKebab` and
  `isActHeadKebab` in `mail-routes.test.ts`'s kebab scan; five mutant sets at floor 1. Each file's holder answered yes to the
  exact diff first (the formats census and the floors pair by chat B's worker; the kebab census by label queue A's).
- **Task A4.** `deploy/overlord-journals-verify.mjs`, read only, through the server build's own `chainedJournalFileAt(…).read()`
  (opened `O_RDONLY`); `_check_overlord-journals` in `ccd/ccrc-doctor-checks` (its holder answered yes first); its suite
  `server/test/ccrc-doctor-overlord-journals.test.ts`; `HEALTHY_SKIPS` raised by one and `FLEET_BOX_CLASSES` gains its row,
  each measured.
- **Task A3, the pure parts.** `shared/actJournalHead.ts` (L0): `ACT_HEAD_DOMAIN`, `actHeadPreimage`, `isActHead` and
  `headExtends`; `server/src/coord/overlordActHead.ts` (L1): `actHeadSignVerdict`; `ApprovalSigner.signActHead`;
  `pwa/src/overlord/actHeadWords.ts` (L1) and `pwa/src/overlord/ActHeadLine.tsx` (L4), the line over a view it is handed.

## 4. Departures, by slug

- **`act-record-kinds-are-prefixed`** (the plan's own, question 1): `act-intent`, `act-settle`, `act-open-request`.
- **`actor-subject-as-the-row-carries-it`**: the record carries the actor's subject as the row does (call 2007, correcting the
  brief's point 2), checked by the identity file's one reader (`readActorColumns`) and each kind's shape: a session id
  (`isSessionIdShape`), the server's lane form, an operator's opaque text within `ACTOR_SUBJECT_MAX`.
- **`authority-checked-by-shape`**: Table 10.1a's `authority` is checked as a word or a word and an id
  (`own`, `delegated`, `ruling:R<n>`, `operator-request:<n>`, `operator-command:<n>`, `grant:<n>`, `autonomy:<n>`, `entry:<n>`).
- **`isolation-held-as-word-or-reason`**: the `isolation` field is a measured word, `unmeasured`, or `unmeasured:<reason>` of
  `ISOLATION_UNMEASURED`; act rows A's store keeps it as text, and the grammar closes it.
- **`request-floor-reads-every-request-id`**: the fold's highest request id reads every request id a record names (an act's
  request, a start's request and an opened request), not the open-request records alone; it can only raise the floor.
- **`highest-act-id-reader`**: `actJournalHighest`, the coordinator's request from the review of #3664: the writer passes the
  journal's highest act id on every write.
- **`head-preimage-in-l0`**: the plan has the signer build the preimage with `rfc8785Json`; it is built once in
  `shared/actJournalHead.ts`, which the signer and the console both read, and the server suite checks it equals the tag, an LF
  and `rfc8785Json` of the four fields.
- **`approvals-disabled-asked-first`**: the sign verdict asks the operator's switch before the isolation word; the plan lists the
  three words without an order.
- **`head-verdict-and-store-in-two-modules`**: the verdict (L1) is `overlordActHead.ts`; the table's writer and the head read's
  store are a module of their own (stage 2), since a file that only calls `db.prepare` would read as L1 by the ring rule.
- **`no-helper-skips`**: a tree that ships no helper SKIPs, as `sigstore-root` does with no verifier (the doctor fixtures' tree
  ships none); Table 3's WARN stays for a missing build, no node, or an answer the check cannot read.
- **`doctor-suite-sources-the-check`**: the suite runs the check in a fixture HOME by sourcing `ccd/ccrc` and the checks file, as
  `approvals-doctor.test.ts` does, rather than through `makeCcdHarness`; it runs no `ccd`.
- **`head-line-over-a-view`**: stage 1's line draws a view it is handed; the head read, the kept head and the WebCrypto check
  that build the view are stage 2's.

## 5. Mutation rows

| Decider | Before (`main`) | After |
|---|---|---|
| `server/src/coord/overlordActRecords.ts#actRecordEntry` | new | 21 of 21 killed |
| `server/src/coord/overlordActRecords.ts#actJournalFold` | new | 9 of 9 (one survivor found and killed by a new case: an act's own request as the highest) |
| `server/src/coord/overlordActRecords.ts#actJournalHighest` | new | 4 of 4 |
| `server/src/coord/overlordActHead.ts#actHeadSignVerdict` | new | 5 of 5 |
| `shared/actJournalHead.ts#headExtends` | new | 9 of 9 |

The doctor check's hand mutations, each run against its suite and reverted: a torn tail graded PASS (3 cases red); the fleet
skip dropped (1); a malformed journal graded WARN (5); the two-line count dropped (1, after a case with an extra valid line was
added: it survived first); an unreadable answer graded PASS (1); the missing-helper arm dropped (1). One more, an out-of-shape
line resetting the words, survived because the line count and the order pattern already catch it, so that reset was removed.

## 6. Known limits

1. **The record holds the operator's device label**, as the row and the sequence line do (call 2007).
2. **The doctor helper needs the server build** beside `deploy/`; a tree placed by `deploy/deploy.sh` builds it on the box, a
   tree without it answers unmeasured (WARN).
3. **The full set of whole-doctor suites** was run in a scratch copy of this branch; the fleet-box class case could not
   arbitrate on this box (an environmental `browser-mcp` WARN, the same on `main`), so the new row was measured with that one
   key set aside, scratch only.
