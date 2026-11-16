# Overlord W2 private names, PR A: build notes

Notes from building PR A (Tasks 1 to 3) of `w2-private-names.md`, for the coordinator to fold into the plan's ledger.
Each departure is named by slug. The coordinator assigns the numbers.

## What shipped

- **Task 1:** `server/test/private-names-characterization.test.ts` pins today's answers, green on `main` before the
  key went in, and unchanged since. It covers `hashEntry` of three synthetic strings and of `CANARY`, `entryOf` and
  `entriesOf` in each mode, and `hitsAt`, `matchLine`, `hitsIn` and `maskText` over twenty synthetic lines. It also
  covers `pairHits` over five line pairs, the committed list's canary hit and digest, and the public-text class
  `private name (hashed)`.
- **Task 2:** the key is a trailing argument that defaults to `PRIVATE_NAME_SALT`, on every function the plan's
  question 1 names. The index is one per entries array and key: `INDEXES` maps an array to a `Map` keyed by the key,
  and the index records its own key. `lookup` and `windows` hash under that key. The pair cache gains `lastKey`.
  `hashOf` caches salted hashes only.
- **Task 3:** `privateNameHits(text, list)` and `PrivateNameListInvalid`, with the JSDoc type `NameList`.
- **Mutation:** two sets in `server/test/sim/privateNamesSets.ts`:
  - `shared/private-names.mjs#hashEntry`: 11 mutants (K1 to K11), all killed, floor 1.
  - `shared/private-names.mjs#privateNameHits`: 9 mutants (H1 to H9), all killed, floor 1.

  The cases are written once, as suites over a module. `private-names-key.test.ts` runs them against the real module.

## Departures

- **`hash-cache-size-reader`**: the plan asks for "a test-only reader" of `HASHES`' size. It is the export
  `hashCacheSize()` from `shared/private-names.mjs`. Nothing in `server/src` calls it.
- **`two-private-name-mutant-sets`**: the plan names one set over the key's threading and `privateNameHits`. It is
  two sets, one key per decider (`#hashEntry` and `#privateNameHits`), in the one file the plan names. So each floor
  reads one decider's score, as every other `MUTANT_SETS` key does.
- **`more-mutants-than-listed`**: besides the plan's list, the sets carry:
  - K2: the first token is hashed under the salt.
  - K3: the run-together form is built under the salt.
  - K9: `pairHits` reads the previous line under the salt.
  - K10: `hitsIn` drops the key.
  - H2: an empty key is allowed.
  - H4: the canary is checked under the salt.
  - H8: the exemptions are applied.
  - H9: a pair's hit is ordered after the later line's own hits.
- **`no-exemption-case-uses-a-crafted-entry`**: the "no `EXEMPTIONS` apply" case cannot spell the exempt upstream
  name, because this tree is scanned for it. Instead it builds a one-token entry that carries the exempt id. A
  one-token entry is found by its first-token hash alone. The case shows that `hitsIn` exempts the hit in a history
  document and that `privateNameHits` still reports it.
- **`pair-hit-ordered-before-the-later-line`**: "the order of first hit" means this: a phrase broken across a line
  break starts on the earlier line. So its id comes before the later line's own hits (H9 pins it).
- **`private-name-hits-splits-on-newline`**: the text is split on `\n` only. A `\r` before it is whitespace to the
  tokenizer and to the pair check, so CRLF text reads the same.
- **`the-canary-is-a-hit`**: a text that spells `CANARY` is a hit, as it is in the committed list. The relay piece
  should know that its own fixture name is reported like any other name.

## Measured

- From `server/`, one file at a time, through `ccrc test`, all green:
  - the key and characterization tests: `private-names-key`, `private-names-characterization`, `private-names`;
  - the scans and their pins: `topology-clean`, `public-text`, `license`, `rings/mjs-node`;
  - the docs guards: `anchors`, `citations`, `dtbd`;
  - `sim/mutation-floors`, its `private-names` cases and the floors-and-sets case;
  - every `single-definition/*` and `rings/*` file;
  - `growth-check`, armed (`GROWTH_CHECK=1`);
  - `deviation-refs`, after `git fetch origin main`.
- The server type check (`tsconfig.json`) is clean.
- No growth-checked file changed. No migration.
