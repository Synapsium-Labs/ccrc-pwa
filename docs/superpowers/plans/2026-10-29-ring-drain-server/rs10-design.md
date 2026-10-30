# RS10 design note: the shape-only masking of tool input moves inward (`D-7513`; ARCH-05)

**Task.** RS10 of `docs/superpowers/plans/2026-10-29-consolidation-ring-exemption-drain-server.md`, which is marked DESIGN NOTE BEFORE BUILD. This note resolves the task's five open problems and gives the build its steps. It is docs only and needs two independent reviews before the build starts. **Once it merges, the build follows this note wherever it differs from the plan's sketch.** This note issues no new D-number. Every choice below falls under `D-7513`, whose subject says the route is the one "its design note records after two reviews".

**Routing.** Band 3, native, for both the note and the build. Secret masking is security-sensitive, so it is never handed off.

**Base.** Measured on `origin/main` `b99070116`. The masking files were re-checked on `cf7cb2da1` (RS2, #1931, merged during the note): RS2 changes none of `accounts/mask.ts`, `transcript/parse.ts`, `transcript/tail.ts`, `secret-mask.test.ts`, `late-census.test.ts` or `advance-switches.test.ts`. On `cf7cb2da1` the set holds **10** entries, and its stamp reads `size: 10`. All prototypes and probes ran on a scratch copy of the tree outside the repository, and none of them is committed. Code is cited by file and symbol.

## The edge, re-measured

- The pair is `server/src/transcript/parse.ts -> server/src/accounts/mask.ts`, L1 → L4. `serverRing` gives the two ends these rings:
  - `parse.ts` is L1 ("no outer-ring fact"). Its runtime imports are `shared/api.js`, `../accounts/mask.js` and `../pane/dialog.js`.
  - `mask.ts` is L4: it "holds a scheduler or poller, its handle on a field this.rekeyTimer".
- One runtime name crosses the edge. In `parse.ts#eventsOfRecord`, `SHAPE_ONLY_MASKER.maskDeep(block.input ?? null)` runs before `JSON.stringify` and before the cut to `TOOL_INPUT_MAX` (D-5995).
- `parseTranscriptLine` has 2 production callers, both in `transcript/tail.ts` (the two `flatMap(parseTranscriptLine)` sites). `tail.ts` is L3, because it imports `node:events`.
- It has **62** test calls: `transcript-parse.test.ts` 58, `w7-compaction-parity.test.ts` 3, `pane-sgr-guard-characterization.test.ts` 1.
- **`SHAPE_ONLY_MASKER`'s other production readers:**
  - `server.ts`: the answer hook, `maskedError`, the catch-up, the drawer's `drawer()`, the pane history's `maskTextSliced`, and `maskDraft`.
  - `sessionws.ts` (`deps.masker ?? SHAPE_ONLY_MASKER`).
  - `coord/routes.ts` (six `maskDeep` sites, and the `masker:` it hands on).
  - `push.ts`'s field default, until RS7 (#1932) moves it to `index.ts`.

  These are all L3–L5 and keep `SHAPE_ONLY_MASKER` exactly as it is.
- No code calls `ingest`, `offer`, `retain` or `close` on the singleton.

## Open problem 1: what the shape-only masker computes

`SHAPE_ONLY_MASKER` is `new SecretMasker()`, built with no options. The constructor gives it the following state:
- `db = null`, so `load()` returns before any read and `rows` stays an empty `Map`;
- `token = () => null`, so `syncKeys()` returns at its first test and `keys` stays `[]`;
- `requestRekey` is a no-op;
- `now = Date.now`.

`maskDeep(v)` is `walk(v, newBudget())`. `walk` calls `maskWithCarry(s, { budget })` on every string. The options hold only `budget`: no `rows`, `context`, `leadingTaint`, `leadingWrap`, `failClosedTail` or `lookahead`.

Each branch of `maskWithCarry`, read from the code and then probed:

| Branch | Reached by a shape-only, row-less, context-less call? | Reads |
|---|---|---|
| `text === ''` early return | yes; it returns `''` (`carry` is `leadingWrap === true`, so false) | nothing |
| `this.syncKeys()` | yes; `this.token()` is `null`, so it returns | the `() => null` closure only; no timer (a rekey is scheduled only after a key is set) |
| frame budget spent, `firstCandidate` cut | **no**. `budget.left` falls only inside `fingerprintSpans`, after its `liveKeys()` test, and `liveKeys()` is empty, so `left` stays 8,192 and `spent` is always `null`. Probed: 0 `firstCandidate` calls | — |
| `shapeSpans(full, false, SHAPES)` | yes, with `full === text` (no context, and `lookahead ?? ''`); `clip` with `off = 0` keeps every span, because every span has `b > a >= 0` | `SHAPES`, and the module-level `viewMemo` |
| leading-taint arm | **no**: the option is not set | — |
| leading-wrap arm | **no**: it needs `rows` | — |
| `fingerprintSpans` with no keys | yes, as a no-op; `liveKeys()` loops over `this.keys = []` and returns `{ spans: [], cut: null }`. Probed: 6,384 calls, every one empty | `this.keys` (empty) and `this.rows` (empty); **never `this.db`** |
| `failClosedTail` | **no**: the option is not set | — |
| cut, and the `SECRET_MASK_TOO_LARGE` suffix | **no**: `fp.cut` is `null`, so `limit = text.length` | — |
| the span splice | yes | `SECRET_MASK` |

**Probes.** During the differential below, the masker's private `firstCandidate`, `fingerprintSpans` and `liveKeys` were wrapped, as were `globalThis.setTimeout` and `Date.now`. The results:
- `firstCandidate`: 0 calls;
- `fingerprintSpans`: 0 non-empty answers;
- `liveKeys`: 0 non-empty answers;
- `setTimeout`: 0 calls;
- `Date.now`: 0 calls;
- after the run, `keys.length === 0`, `rows.size === 0` and `db === null`.

The shape-only call reads no timer, no clock and no database. It touches `this.keys` and `this.rows` only to find them empty.

**So `SHAPE_ONLY_MASKER.maskDeep(v)` is a plain function of `v`.** It is the deep walk with each string `s` replaced by `s === '' ? s : spliceMasked(s, shapeSpans(s, false, SHAPES).spans, s.length)`, where `spliceMasked` is `maskWithCarry`'s own span-assembly loop. The budget never takes part, so it does not move (see Problem 2).

**The differential, run on main.**
- *The corpus.* While `secret-mask.test.ts` ran (85 passed, 1 skipped), every argument passed to `SecretMasker.prototype.maskWithCarry` or `maskDeep` was recorded by a hand-written pass-through wrapper on the prototype (not by `vi.spyOn`; Step 1 says why). That gave 2,971 distinct strings and 51 deep values, 3,022 inputs in all:
  - 1,206 of them are changed by the mask;
  - 713 hold an ESC;
  - 54 are longer than the 4,000-unit tool-input cut.

  The counts vary by a few strings from run to run (2,968 strings and 49 values on the second run), because the drawer rows split their chunks by timer.
- *The comparison.* For each input `v`, the run compared:
  - `SHAPE_ONLY_MASKER.maskDeep(v)`;
  - `new SecretMasker().maskDeep(v)`;
  - the candidate L1 function above.

  It also compared the full `parseTranscriptLine` output for an assistant `tool_use` record holding `v`, between today's `parse.ts` and a copy wired to the candidate. **Result: 0 mismatches of each kind, out of 3,022.**
- *Control mutants of the candidate,* each red:

  | Mutant | Inputs it changed |
  |---|---|
  | identity | 1,206 |
  | the stripped view only, dropping the ESC-as-delimiter view | 1 |
  | `BOUNDARY` without the JSON-escape lookbehind | 2 |

## Open problem 2: the route

**Ruled: route (a), one owner.** Route (b) threads a masker through `parseTranscriptLine`, its 62 test calls, `tail.ts` and `tail.ts`'s callers, so it is not taken. Route (c) is rejected: D-5995 masks the decoded input before it is serialized and cut, and a caller sees only the cut string.

**The new file is `server/src/accounts/shapes.ts`, ring L1, context C1** (the `accounts/**` row of the 08-10 spec's context table, so no spec edit is needed). It holds the following.

- **Moved verbatim from `mask.ts`.** Only `export` keywords are added (where `mask.ts` reads a name), plus a new file header.
  - The `RUN_MIN_BYTES` / `RUN_MAX_BYTES` pair with their shared doc line. `joinWraps` bounds a run by `RUN_MAX_BYTES`, and the pair shares one doc comment.
  - The whole "two views of a text" section: `ESC_SEQ`, `indentOf`, `rowMove`, `View`, `viewMemo`, `viewOf`, `cursorForward`, `buildView`, `spanIn`, `origin`.
  - The whole "shapes" section: `BOUNDARY`, `shapeMatchers`, `SHAPES`, the row helpers (`ROW_END`, `rowTextEnd`, `ROW_INDENT`, `TOKEN_RUN`, `TEXT_END`, `continuationAfter`, `leadingRun`), `ZERO_COLUMN`, `columnsOf`, `Rows`, `SHAPE_HINT`, `SHAPE_STARTED`, `isRunByte`, `joinWraps`, `LINE_BREAK_ANY`, `matchesShape`, `seamWithin`, `firstSeamAfter` and `shapeSpans`.

  That is 299 lines. Once the added `export` words are stripped, a diff of the two copies is empty.
- **Moved from `SecretMasker`, one owner and no copy:**
  - `spliceMasked(text, spans, limit)`, the span splice loop of `maskWithCarry`, including its `spans.sort` and its "Parts joined once" comment;
  - `walkStrings(v, mask)`, the body of `SecretMasker#walk`, with `this.walk(…, budget)` replaced by a call through `mask`.
- **New:**
  - a private `maskShapes(text)`, the reduction measured above;
  - `export const SHAPE_MASK: { maskDeep<T>(value: T): T }`, which is `walkStrings(value, maskShapes)`.

  `SHAPE_MASK`, `spliceMasked` and `walkStrings` are free names in `server/src`, `server/test`, `shared`, `pwa/src` and `agent` (measured).

**What stays in `mask.ts`.** `SecretMasker` keeps its shape half, but routes it through the helpers above:
- `maskWithCarry` calls `shapeSpans` and `spliceMasked` (`text: cutAt === null ? masked : masked + SECRET_MASK_TOO_LARGE`, which is byte-identical to pushing the notice last);
- `maskDeep` becomes `walkStrings(value, (s) => this.maskWithCarry(s, { budget }).text)` over one `newBudget()`, and the private `walk` goes;
- `DrawerMask`, `fingerprintSpans`, `firstCandidate`, `failClosedStart`, `rowTailAt` and `runClosed` import `viewOf`, `spanIn`, `origin`, `rowTextEnd`, `leadingRun`, `matchesShape`, `SHAPE_STARTED`, `ROW_END`, `ROW_INDENT`, `TOKEN_RUN` and `RUN_*` from `./shapes.js`.

Because the two maskers share these helpers and one `viewMemo`, their masked output cannot drift apart.

**The budget does not move.** `MaskBudget`, `newBudget`, `RUNS_PER_CHUNK` and `MAX_CHUNKS` belong to the exact-bytes pass, and Problem 1 measured that the shape pass never reads them. `SHAPE_ONLY_MASKER` stays `new SecretMasker()` for the L3–L5 egresses that need `drawer()`, `maskText` and `maskTextSliced`. `mask.ts` no longer imports `CREDENTIAL_MASKS` or `CredentialMask`, and it keeps `SECRET_MASK` and `SECRET_MASK_TOO_LARGE`.

**Public surface.**
- `mask.ts` stops exporting `shapeMatchers`, `RUN_MIN_BYTES` and `RUN_MAX_BYTES`, and adds no re-export. Measured across `server`, `shared`, `pwa/src` and `agent`: the only outside importer of any of the three is `secret-mask.test.ts` (`shapeMatchers`), and its import line moves to `../src/accounts/shapes.js`.
- `parse.ts` imports `{ SHAPE_MASK } from '../accounts/shapes.js'` and calls `SHAPE_MASK.maskDeep(block.input ?? null)`. The D-5995 comment at that call stays.

**Rings, measured with `serverRing` on the scratch tip:**

| File | Ring | Why | Runtime imports |
|---|---|---|---|
| `accounts/shapes.ts` | L1 | "no outer-ring fact" | `shared/api.js` |
| `accounts/mask.ts` | L4 | `this.rekeyTimer` | `node:crypto`, `shared/api.js`, `./shapes.js` |
| `transcript/parse.ts` | L1 | — | `shared/api.js`, `../accounts/shapes.js`, `../pane/dialog.js` |

So the new pairs are:
- `parse.ts -> shapes.ts`: L1 → L1;
- `mask.ts -> shapes.ts`: L4 → L1, inward;
- `shapes.ts -> shared/api`: L1 → L0.

**Checked at the scratch tip:**
- **Ring tests:** `outward-edges.test.ts` (6/6), `exemption-age.test.ts` (4/4) and `totality.test.ts` (9/9) pass, with the entry deleted and the stamp at the count.
- **Typecheck:** `tsc --noEmit` passes. `tsc -p test/tsconfig.tests.json` reports no error in any file this note touches. Its other errors exist only because the scratch tree had no `ccd/`, `deploy/` or `.github/` when it ran.
- **Suites:**
  - `transcript-parse.test.ts` 89/89;
  - `secret-mask.test.ts` 85 passed, 1 skipped;
  - `pane-sgr-guard-characterization.test.ts` 128/128.

  The moved `ESC_SEQ` does not match that last suite's `STRIPPER_RE`, and neither does `mask.ts` today.
- **Differential at the tip:** 0 of 3,017 inputs differ between main's `SHAPE_ONLY_MASKER`, the tip's `SHAPE_MASK`, the tip's `SHAPE_ONLY_MASKER`, and main's versus the tip's whole `parseTranscriptLine` output.

## Open problem 3: rule 6, against the open PRs

Measured on 2026-10-30 with `gh pr list --state open --json number,files` (21 open PRs) and `gh pr diff` for each PR that holds a file RS10 touches.

**Files RS10's build touches:**
- `server/src/accounts/mask.ts`
- `server/src/accounts/shapes.ts` (new)
- `server/src/transcript/parse.ts`
- `server/test/secret-mask.test.ts`
- `server/test/single-definition/late-census.test.ts`
- `server/test/single-definition/advance-switches.test.ts`
- `server/test/rings/outward-edges.data.ts`
- `server/test/rings/exemption-age.data.ts`

**No open PR holds any of these:** `accounts/mask.ts`, any other file under `server/src/accounts/`, `transcript/parse.ts`, `transcript/tail.ts`, `late-census.test.ts`, `transcript-parse.test.ts` or `citations.test.ts`.

| PR | Its hunk in an RS10 file | RS10's hunk there | Verdict |
|---|---|---|---|
| #1872 (idle coordinators roll; mergeable state CONFLICTING, being finished) | `secret-mask.test.ts`: one line added to `WRITE_ANSWER_EXEMPT`'s map in "the rulings: every egress…" | the `../src/accounts/mask.js` import block near the top; the custody row's reader in "secret_fingerprints never leaves the server"; one block appended at the file's end | line-disjoint (each RS10 hunk is far more than three lines from #1872's) |
| #1932 (RS7, push port; mergeable) | `secret-mask.test.ts`: its one `new PushService(` call in "every other egress…"; the stamp line; the `push.ts` key | the same three `secret-mask.test.ts` places; the same stamp line; the `parse.ts` key | `secret-mask.test.ts`: line-disjoint (the custody row sits after the end of #1932's describe and is more than three lines from its hunk). **The stamp line is the same line:** they cannot land together |
| #1933 (RS4, link errors) | `outward-edges.data.ts`: deletes the `token/link.ts` and `update/converge.ts` keys, the two keys on either side of `parse.ts`'s key, which its hunk carries as context; the stamp line | deletes `parse.ts`'s key; the stamp line | **textual conflict** (adjacent deletions, and the same stamp line) |
| #1934 (RS6, journal split) | `advance-switches.test.ts`: the `delegation-journal.ts` row of the every-other-file `CEILING`; `outward-edges.data.ts`'s two delegation keys; the stamp line | deletes that `CEILING`'s `accounts/mask.ts` row (its first row, more than three lines above #1934's); the `parse.ts` key; the stamp line | `advance-switches.test.ts`: line-disjoint. **The stamp line is the same line** |

**Order.** RS10's build lands **after RS7 (#1932)**, as the plan's landing order has it, and after #1933 and #1934. Whichever of these is still open when RS10 reaches the queue, RS10 rebases onto it after it merges. On each rebase it keeps every other PR's deletions, recounts the set and rewrites the stamp from the count; it never keeps a stale size. Both PRs touch `secret-mask.test.ts` too, so RS10 waits for #1932 rather than landing beside it.

The build's Step 0 measures all of this again on its own base.

## Open problem 4: the pins over `mask.ts`'s text

Measured by running the counting rule (`advance-switches.test.ts`'s `literalSourcePinScan`) on the scratch copy. The tip leaves `mask.ts`'s count at 1. With the custody reader moved to `parsedFile`, the count is 0, and the `mask.ts: 1` row reds with "expected +0 to be 1".

1. **`advance-switches.test.ts`, the every-other-file `CEILING`, `'server/src/accounts/mask.ts': 1`.**
   - *The pin it counts:* `secret-mask.test.ts`'s custody row, "`secret_fingerprints` is read by mask.ts only and is in no route's answer". Its `readFileSync(path.join(srcRoot, 'accounts', 'mask.ts'), 'utf8')` feeds `not.toMatch(/app\.(get|post|put|delete)\(|reply\.|FastifyInstance/)`.
   - *Effect of the move:* the row stays green (`mask.ts` still registers no route). The `secret_fingerprints` holder list stays `['accounts/mask.ts', 'coord/schema.ts']`, because the moved text never spells the table's name (checked).
   - *Re-point (Step 2):* the reader becomes `parsedFile('server/src/accounts/mask.ts').text` (`./scan/symbols.js`, which the file already imports). The assertion, the regex and the title keep their bytes. The count falls 1 → 0, so the same commit **deletes the `CEILING` row** (an absent file has a ceiling of 0).
   - *Measured on the scratch copy:* with the reader changed and the row left in, the row reds; with the row deleted, every `CEILING` row is green.
   - *`shapes.ts`:* it gains no row, because nothing reads it as text. A route or `fastify` import in it would make it L4, and `outward-edges.test.ts` would then red the fresh `parse.ts -> shapes.ts` pair.
2. **`single-definition/late-census.test.ts`, "the credential shapes and the egress mask each have one home (D-5513)".** This is a whole-tree declaration census (`holders(decl(c))` over `stallCode` of `ALL`, comment lines dropped). It is not a literal source pin, and the counting rule does not count it (measured: the `mask.ts` count is the custody row alone). At the scratch tip, exactly two of its rows red, as predicted:
   - **"the mask lives in its one file":** `shapeMatchers: expected [ 'server/src/accounts/shapes.ts' ] to deeply equal [ 'server/src/accounts/mask.ts' ]`.
     - *Re-point (Step 3, in the move commit):* `'shapeMatchers'` leaves the loop's name list, and one line asserts `expect(holders(decl('shapeMatchers')), 'shapeMatchers').toEqual(['server/src/accounts/shapes.ts'])`.
     - The loop keeps its other seven names and its `toEqual(['server/src/accounts/mask.ts'])` bytes, and the row keeps its title.
   - **"maskSecretAssigns's file and mask.ts read the shapes from CREDENTIAL_MASKS, and no other file spells one":** the `CREDENTIAL_MASKS` reader list becomes `['server/src/accounts/shapes.ts']`, since `mask.ts` no longer imports it.
     - *Re-point:* that one expected array changes. The title keeps its bytes, though it still says "mask.ts", and every other assertion of the row keeps its bytes.
   - **Owner commit (Step 4):** the census gains a "one owner" row. It goes through `scan/symbols.ts`, so it is not a literal pin:
     - `callsIn(symbolOf('server/src/accounts/mask.ts', 'SecretMasker.maskWithCarry'))` names `shapeSpans` and `spliceMasked`;
     - `callsIn(symbolOf(…, 'SecretMasker.maskDeep'))` names `walkStrings`;
     - `parsedFile('server/src/accounts/mask.ts').symbols` holds no `SecretMasker.walk`;
     - `holders(decl(n))` is `['server/src/accounts/shapes.ts']` for each of `shapeSpans`, `spliceMasked`, `walkStrings` and `SHAPE_MASK`.

     These symbol names were probed on the scratch tip, where `parsedFile` lists `SecretMasker.maskWithCarry` and `SecretMasker.maskDeep` and no `SecretMasker.walk`.
3. **`secret-mask.test.ts`:**
   - its import of `shapeMatchers` moves to `../src/accounts/shapes.js` (an import edit in the move commit);
   - the custody reader is re-pointed (item 1);
   - no other row reads `mask.ts`'s text.

   The suite's other `readFileSync` readers read `server.ts`, `sessionws.ts` and the route files, which the move does not touch.

The changes to ceilings: one row falls from 1 to 0 and is deleted. No row is added, and no new literal source pin is added.

## Open problem 5: citations in the moved text

`citations.test.ts`'s `CITATION` is `/ccd:\d{3,5}\b|\.(?:ts|tsx|mjs|sh):\d+\b/g`. Matched against everything the build moves (the `RUN_*` pair, both sections, the splice loop, `walk`'s body), it finds **0 hits**. It also finds 0 in the whole of `mask.ts`. So no rewrite is needed, and `BASELINE` stays as it is.

Relative pointers in the moved comments ("below", "above", "this module"): none point across the cut. The one "here" (in `buildView`) refers to the loop position.

The new header and `SHAPE_MASK`'s doc cite symbols only (`accounts/mask.ts#SecretMasker`). `citations.test.ts` is in the build's verify list.

## The build

**Branch** `refactor/ring-drain-parse-mask`, from a fresh `origin/main` worktree. Every git and test command takes the plan's `env -u …` prefix. vitest runs one file at a time, with `--maxWorkers=2`, in the foreground.

- [ ] **Step 0: Re-ground**, and report any count that differs before any commit.
  - The rings of `parse.ts` (L1) and `mask.ts` (L4).
  - The set's keys and stamp (10 on `cf7cb2da1`).
  - `parseTranscriptLine`'s callers (2 production, 62 test).
  - `SHAPE_ONLY_MASKER`'s readers.
  - That nothing calls `ingest`, `offer`, `retain` or `close` on it.
  - That no importer of `shapeMatchers` or `RUN_*` exists outside `secret-mask.test.ts`.
  - The `CITATION` hits in the moved text (0).
  - `mask.ts`'s `CEILING` count (1, the custody row).
  - Rule 6 against every open PR on the eight files above, with `gh pr diff`, and the order against #1932, #1933 and #1934.
  - Whether this drain empties the set. If it does, this commit also re-points `exemption-age.test.ts`'s CONTROL row (plan, §Global constraints). On the measured order it does not: RS5 stays gated.
- [ ] **Step 1: Characterization commit, green on `main`.** One `describe` is appended at the end of `secret-mask.test.ts`: "the transcript parse masks tool input as the shape-only masker does, over this file's corpus (D-7513)".
  - **Why not `vi.spyOn`.** The pinned vitest (5.0.5) defaults `clearMocks` to `true`, and `server/vitest.config.ts` does not override it. So every spy's `mock.calls` is emptied before each test, and a spy installed at collection holds, in the last test, only that test's own calls. Measured on `6ecd27b67`: a `vi.spyOn(SecretMasker.prototype, 'maskText')` installed at collection saw 0 of the 1,429 calls the earlier tests made, while a wrapper beside it counted all 1,429. A corpus read from `mock.calls` would be empty and the CONTROL row below would fail on `main`. `mockRestore()` would clear the calls as well. So the recorder keeps its own arrays and never reads `mock.calls` across tests.
  - **Recording.** At the end of the file, outside any `describe`, module-level bindings are declared: `recorded: { strings: string[]; deep: unknown[] }`, a flag `recording = true`, and the two original methods. While the file is collected, before any test runs, `SecretMasker.prototype.maskWithCarry` and `SecretMasker.prototype.maskDeep` are replaced by hand-written pass-through wrappers. Each wrapper pushes its first argument into `recorded.strings` or `recorded.deep` while `recording` is true, then returns `original.call(this, ...args)` unchanged. The file sets no `sequence.shuffle`, and nothing else in it reassigns those two methods (measured).
  - **Restoring.** A file-level `afterAll`, declared beside the block and outside it, puts the two originals back. It is file-level, not in the block and not in a row, so a run filtered with `-t`, or one that skips the block, still restores them.
  - **Why the block runs last.** vitest runs a file's tests in order, so the block's rows run after every other row in the file. The block's own `beforeAll` runs after every earlier test and before its first row. It sets `recording = false` and copies `recorded` into the block's `corpus` (strings de-duplicated, deep values kept in order). From then on the rows' own calls (the reference maskers, `parseTranscriptLine`) are not recorded. By then the corpus holds every input the suite has fed any masker, including the drawer chunks, the pane slices, the frames and the parse's own calls. A run filtered to the block alone records almost nothing, so its CONTROL row fails by design. The corpus belongs to the full file run.
  - **The rows:**
    - Each row reads `corpus`, never `recorded` and never a spy's `mock.calls`.
    - **CONTROL:** the recorded corpus is not thin. It holds at least 2,000 distinct strings, at least 40 deep values, at least 1,000 inputs that `new SecretMasker().maskDeep` changes, at least 500 strings holding an ESC, and at least 40 longer than 4,000 units. Measured: 2,968–2,971, 49–51, 1,206, 713 and 54. Re-measured with this recorder on `6ecd27b67`, three full-file runs (86 passed, 1 skipped, the probe included): 2,971 strings each time, 49–51 deep values, 1,206 changed, 713 with ESC, 54 longer than 4,000, and 0 mismatches in both the singleton row and the differential row.
    - **The differential.** For each recorded input `v`:
      - `line` is an assistant record whose one content block is `{ type: 'tool_use', id: 't', name: 'Bash', input: v }`;
      - `decoded` is `JSON.parse(line)`'s input;
      - `want` is `JSON.stringify(new SecretMasker().maskDeep(decoded ?? null)) ?? ''`;
      - `ev` is `parseTranscriptLine(line)`'s one `tool_use` event.

      The row asserts: if `want.length <= 4000`, then `ev.input === want` and `ev.truncatedBytes === 0`. Otherwise `want.startsWith(ev.input)`, `ev.input.length <= 4000`, and `Buffer.byteLength(want) - Buffer.byteLength(ev.input) === ev.truncatedBytes`.

      The reference is a **fresh** keyless `SecretMasker`, never `parse.ts`'s own import. So after the drain this row is exactly the differential between the L1 value and `SecretMasker`, and no byte of it changes.

      The row also asserts that `SHAPE_ONLY_MASKER.maskDeep(v)` deep-equals `new SecretMasker().maskDeep(v)`: the singleton keeps no state.
    - **Keyless reach:** `SHAPE_ONLY_MASKER.fingerprintMax()` is `null`. While the differential loop runs, spies see 0 calls of `globalThis.setTimeout` and 0 of `Date.now` (measured: 0 and 0; these spies are created and read inside the one row, so `clearMocks` does not touch them, and the row restores them before it ends).
    - A failing message names the input's index and `SECRET_MASK`'s count, never the input.

  The fixtures stay assembled at run time, as the file's header requires, so no whole shape is written into the tree.
- [ ] **Step 2: Custody re-point commit.** In the custody row, `readFileSync(path.join(srcRoot, 'accounts', 'mask.ts'), 'utf8')` becomes `parsedFile('server/src/accounts/mask.ts').text`; nothing else in the row changes. The same commit deletes `advance-switches.test.ts`'s `'server/src/accounts/mask.ts': 1` row (measured: the count goes 1 → 0).
- [ ] **Step 3: Move commit.** This commit changes no behaviour.
  - Create `server/src/accounts/shapes.ts`: the header, the `shared/api.js` import (`CREDENTIAL_MASKS`, `SECRET_MASK`, `type CredentialMask`), the `RUN_*` pair, and the two sections, moved verbatim with `export` added where `mask.ts` reads a name.
  - `mask.ts` deletes them and imports them from `./shapes.js`. Its `shared/api.js` import keeps `SECRET_MASK` and `SECRET_MASK_TOO_LARGE`.
  - `secret-mask.test.ts`'s `shapeMatchers` import line moves to `../src/accounts/shapes.js`.
  - `late-census.test.ts`'s two rows are re-pointed (Problem 4, item 2).
  - Step 1's block does not change.
- [ ] **Step 4: Owner commit.**
  - `spliceMasked` and `walkStrings` move from `SecretMasker` into `shapes.ts`; `maskWithCarry` and `maskDeep` call them, and the private `walk` is deleted.
  - Add `maskShapes` and `SHAPE_MASK`.
  - Add two rows. Each is red on `main`, where the names do not exist, so each is added here and not in Step 1:
    - in Step 1's block: `SHAPE_MASK.maskDeep(v)` deep-equals `SHAPE_ONLY_MASKER.maskDeep(v)` for every recorded input (its import line names `../src/accounts/shapes.js`);
    - in `late-census.test.ts`: the "one owner" row (Problem 4, item 2).
- [ ] **Step 5: Drain commit (−1).**
  - `parse.ts`'s import becomes `{ SHAPE_MASK } from '../accounts/shapes.js'`, and its call becomes `SHAPE_MASK.maskDeep(block.input ?? null)`.
  - Delete `'server/src/transcript/parse.ts -> server/src/accounts/mask.ts'` from `outward-edges.data.ts`.
  - Rewrite the stamp: `size` from the count at this commit, `since` set to this commit's day, and a reason naming D-7513.
  - Step 1's block does not change.
- [ ] **Step 6: Mutation table, RUN** (each mutant applied alone at the tip, run, then reverted):

  | Mutant | Expected red |
  |---|---|
  | `SHAPE_MASK`'s string mask is the identity | the differential row and the `SHAPE_MASK` row (measured at the candidate: 1,206 inputs) |
  | `maskShapes` reads only the stripped view of the escapes (a private copy of `shapeSpans` that breaks before the `'\0'` view) | the differential and `SHAPE_MASK` rows (measured: 1); `late-census`'s one-owner row (a second `shapeSpans`) |
  | `shapes.ts` keeps a second `BOUNDARY` without the JSON-escape lookbehind for `SHAPE_MASK` | the differential and `SHAPE_MASK` rows (measured: 2) |
  | `parse.ts` keeps `SHAPE_ONLY_MASKER` from `../accounts/mask.js` | `outward-edges.test.ts` (a fresh pair: the entry is gone) |
  | `shapes.ts` imports `RUN_MAX_BYTES` from `./mask.js` | `outward-edges.test.ts` (fresh pair `shapes.ts -> mask.ts`, L1 → L4) |
  | `shapes.ts` evicts `viewMemo` with a `setTimeout` held on a module-scope name | `shapes.ts` becomes L4, so `outward-edges.test.ts` reds `parse.ts -> shapes.ts` and `mask.ts`'s import stays inward |
  | `SecretMasker` keeps its own `walk` | `late-census`'s one-owner row |
  | `maskWithCarry` appends `SECRET_MASK_TOO_LARGE` before the splice | `secret-mask.test.ts`'s budget rows |
  | the custody row's reader goes back to `readFileSync` | `advance-switches.test.ts` (a pin over a file with no row) |
  | `shapes.ts`'s header names the fingerprint table | `secret-mask.test.ts`'s custody holder list |

- [ ] **Step 7: Verify,** one at a time, from `server/`:
  - `secret-mask.test.ts`
  - `transcript-parse.test.ts`
  - `w7-compaction-parity.test.ts`
  - `pane-sgr-guard-characterization.test.ts`
  - `continued-in-parity.test.ts`
  - `approval-raise.test.ts`
  - `approvals-routes.test.ts`
  - `single-definition/late-census.test.ts`
  - `single-definition/advance-switches.test.ts`
  - `citations.test.ts`
  - `rings/outward-edges.test.ts`
  - `rings/exemption-age.test.ts`
  - `rings/totality.test.ts`
  - `growth-check.test.ts`
  - `deviation-refs.test.ts`
  - both `tsc` runs

**Exit (GATE), counted.**
- No key from `transcript/parse.ts` in `OUTWARD_EDGE_EXEMPTIONS`.
- The stamp is rewritten with `size` set to the count at the commit.
- `serverRing` gives `shapes.ts` L1, `parse.ts` L1 and `mask.ts` L4.
- `parse.ts` names neither `SHAPE_ONLY_MASKER` nor `accounts/mask`.
- `SHAPE_ONLY_MASKER`'s readers are unchanged, except for RS7's `push.ts` → `index.ts`.
- Every masked string `parseTranscriptLine` emits is unchanged over the corpus: Step 1's differential row passes unedited from Step 1 to the tip.
- The PR body prints the set's keys and the stamp at base and at tip. It also prints the callers of `SHAPE_ONLY_MASKER`, `shapeMatchers` and `SHAPE_MASK` at base and at tip, by file and symbol.

**Must not change:** any masked output, from any egress. **Rollback:** `git revert`.

## Growth estimate

Net code lines, counted by `growthCheck.ts#codeLines`:

| File | Before | After | Change |
|---|---|---|---|
| `accounts/mask.ts` | 959 (1,307 lines) | 701 (979 lines) | −258 |
| `accounts/shapes.ts` (new) | — | 269 (357 lines) | +269 |
| `transcript/parse.ts` | 271 | 271 | 0 |
| **source, net** | | | **+11** |

The +11 is the new header, `maskShapes` and `SHAPE_MASK`. The tests add about 60 lines (Step 1's block and Step 4's row) and about 15 (`late-census`). None of these files is on `growth-check.test.ts`'s `GROWTH_FILES` list, so the check is not affected.

## What this note does not change

- No `pwa/`, `agent/`, `ccd/` or `shared/` file.
- No wire field, and no change in what any masker answers.
- No edit to the plan or to any Deviations section.
