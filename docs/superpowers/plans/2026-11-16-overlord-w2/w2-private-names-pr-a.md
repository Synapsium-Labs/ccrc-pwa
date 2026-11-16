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
  - `shared/private-names.mjs#hashEntry`: 15 mutants (K1 to K15), all killed, floor 1.
  - `shared/private-names.mjs#privateNameHits`: 18 mutants (H1 to H18), all killed, floor 1.

  The cases are written once, as suites over a module. `private-names-key.test.ts` runs them against the real module.

## Departures

- **`hash-cache-size-reader`**: the plan asks for "a test-only reader" of `HASHES`' size. It is the export
  `hashCacheSize()` from `shared/private-names.mjs`. Fix round 1 adds two more test-only readers beside it:
  `retainedLine()` (the line the pair cache holds) and `cachedTokenHashes(entries, key)` (an index's token cache, as
  hash rows). Nothing in `server/src` calls any of the three.
- **`two-private-name-mutant-sets`**: the plan names one set over the key's threading and `privateNameHits`. It is
  two sets, one key per decider (`#hashEntry` and `#privateNameHits`), in the one file the plan names. So each floor
  reads one decider's score, as every other `MUTANT_SETS` key does.
- **`more-mutants-than-listed`**: besides the plan's list and the fix round's guards, the sets carry:
  - K2: the first token is hashed under the salt.
  - K3: the run-together form is built under the salt.
  - K9: `pairHits` reads the previous line under the salt.
  - K10: `hitsIn` drops the key.
  - H6: the canary is checked under the salt.
  - H10: the exemptions are applied.
  - H11 and H12: a pair's hit is placed after the later line, or the ids are not ordered by position.
- **`no-exemption-case-uses-a-crafted-entry`**: the "no `EXEMPTIONS` apply" case cannot spell the exempt upstream
  name, because this tree is scanned for it. Instead it builds a one-token entry that carries the exempt id. A
  one-token entry is found by its first-token hash alone. The case shows that `hitsIn` exempts the hit in a history
  document and that `privateNameHits` still reports it.
- **`hits-are-whole-text`** (fix round 1, review 2306 F1, the coordinator's ruling, a departure from the plan's
  question 2 and Task 3's "split across three is not"):
  - `privateNameHits` reads the WHOLE text with `hitsAt`, so any whitespace run joins a phrase's words. That includes
    line breaks, blank lines, whitespace-only lines and CRLF. No split of a name over lines passes.
  - Each pair of adjacent lines is still read, but only to add hits: it finds a phrase broken across a repeated comment
    or quote marker (`// zed` then `// quux`), which the whole text joins with "other". It never gates a hit.
  - The ids are ordered by where each hit starts. A pair's hit is placed at the end of its first line.
  - A generated-text property pins "never misses what whole-text `hitsAt` finds". H13 (the line gate restored) reds it.
  - This supersedes the first round's `private-name-hits-splits-on-newline` and `pair-hit-ordered-before-the-later-line`.
- **`the-index-rebuilds-on-a-changed-list`** (fix round 1, F2): an index records its array's length and its first and
  last entries, and rebuilds when any differs. So an append, or a replaced end, is never scanned against a stale index.
  The check is O(1), so the tree scan's per-line cost is unchanged. A replaced middle entry is not detected: the one
  reader PR B adds builds a new array per generation.
- **`token-hashes-seeded-by-the-key`** (fix round 1, F3 and F4): the tokenizer's two cheap token hashes start from
  bases derived from the key (an HMAC of a fixed label), and from the fixed bases under the salt, so the tree scan is
  unchanged.
  - A keyed index's token cache holds no unkeyed hash of an egress token.
  - Two keys never share a cached row.
  - A collision crafted to hide a name needs the key.
  - `privateNameHits` clears the pair cache's line and index in a `finally` before it returns, so the matcher keeps none
    of its text. The pair cache now keys on the index, which is per array and per key, in place of the array and the
    key separately.
- **`private-name-hits-one-refusal`** (fix round 1, F5): `privateNameHits` throws `PrivateNameListInvalid` for every
  input it will not scan, before anything is scanned:
  - the public salt as a key;
  - a key under `NAME_LIST_KEY_MIN_BYTES` (16) UTF-8 bytes;
  - a non-string text;
  - any entry that is not `{ h, f }` as 32 lower-case hex with an integer `n >= 1` and a mode in `MODES`.

  So the relay reads one word.
- **`the-canary-is-a-hit`**: a text that spells `CANARY` is a hit, as it is in the committed list. The relay piece
  should know that its own fixture name is reported like any other name.

## For PR B

- **A list whose names were built under another key** (review 2306 F5): the canary check sees only the first entry, so
  a list whose canary is under the key but whose other entries were built under another would scan clean. That list
  cannot arise once PR B's upload door builds every entry under the server's key, in one pass, the canary first. PR B's
  brief should carry it.

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

## Measured, fix round 1

- The same files were re-run, one at a time through `ccrc test`, all green:
  - `private-names-key` (22), `private-names-characterization` (26, unchanged), `private-names`;
  - `topology-clean`, `public-text`, `license`;
  - `anchors`, `citations`, `dtbd`, `deviation-refs`;
  - the whole of `sim/mutation-floors` (128 of 128);
  - every `single-definition/*` and `rings/*` file;
  - `growth-check`, armed.
- `tsc` is clean in `server/` (both configs) and in `pwa/`.
