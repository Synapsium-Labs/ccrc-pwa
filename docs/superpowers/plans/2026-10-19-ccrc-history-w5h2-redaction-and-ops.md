# ccrc history wave 5h-2: B2's redaction and operations hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Close the programme ledger's "Owed from B2" items 1–5 and "Owed from B3" items 1–2 in ONE PR on `main`, executed after wave 5h-1 (run 626) merges. B2 left the recall redaction and the operator passes working with five known gaps, and B3 left two wording errata. This plan closes them, task by task:
- **Task 1.** The named value class widens in its FIELD form only (R1), and every redaction door reads the widened rules only over its rev 3.6 door's output (R11, the coordinator's composition ruling of 2026-10-19, which amends R1 and R3). A quoted value (`"` or `'`) is read to its closing quote on the same line, and an empty quoted value counts as no value. An unquoted value still ends at whitespace and the backtick; `&` ends it only before `NAME=`; `,` `;` `"` `'` end it only before whitespace, a closer or the end of the text. So `password=abc&def`, `password="abc&def"` and `PASSWORD='a b c'` are masked whole, while `url?a=1&password=x&b=2`, `password=abc; path=/` and `{"cmd":"password=abc"}` keep their structure. This is the prototype scope b2-redaction measured; the final form's named value class, and with it D-4613's structure safety, is unchanged. Each door is `v2(base(text))`: `base` is the door as rev 3.6 built it, from the frozen module-private `BASE_RULES`, and `v2` is the same door built from the widened rules, read over `base`'s output. Every reading is subtractive: its output is its input, a JSON-escape decoding of it, or its input with escape sequences removed (D-4307's joined reading), with spans replaced by the mark, and it writes no character its input did not hold. So no door prints a value its rev 3.6 door masks, a masked value being one that no reading of that door's output holds (as written, decoded, or with its sequences removed): by construction, and pinned by a property case over f2Cases and two seeded corpora (one of them plants colour sequences inside NAMEs and values) through all eleven doors, one case, (j9), that checks composition and subtractiveness for every door, and a mutant that reads the widened rules over the raw text. Two review rounds (the plan's third and fifth) found three shapes (a quoted value that takes a NAME in, an unclosed quote a closer follows, a `NAME=value` glued to an escaped JSON pair); they are closed by construction, so their three patches are withdrawn: v1's named reading unioned into the field pass, the opening quote admitted before a closer, and the backslash stop. The widening that composition loses (a value whose NAME the base's mark already took in) is a named residual, and so is a pre-existing one of the field door, `redactFinalLines` and the index and display doors (a JSON key's next pair, read as one text). A third is the joined reading's: where the `v2` reading finds a value only with a text's escape sequences removed, the door returns the text without them, so a value the base door printed split by a sequence prints whole (the base door does the same where its own rules find one). A fourth is the same mechanism at a JSON-decoded level: where the `v2` reading finds a value only at a decoded level, the index and display doors return that level, so a value the base printed only escaped prints decoded and an index row gains it as one term (the plan's seventh review). The task amends spec §8.3's layer-2 value sentence (D-5745).
- **Task 2.** Text already stored heals as a sweep phase (R3, as R11 amends it). `BELT_VERSION` goes from 1 to 2, so every store opens one belt generation. Under a re-derivation probe (`makeProbeIndex` with `beltAll`), Task 1's `composeDoor` counts one owed hit when a door's v2 reading changes its base reading's text, its rev 3.6 reading, which is the text a BELT_VERSION 1 build stored, so the generation rewrites a row exactly when its composed index text differs from its rev 3.6 reading (the stored text, on a store a BELT_VERSION 1 build wrote), beside the rows every belt generation rewrites (a pair above the mark, a layer-4 or glue-window hit). Every later re-derivation, a pair-owed walk or a roll-forward after a rollback included, rewrites those rows again with the text they already hold. That comparison replaces a rule-hit probe: it is simpler and cannot undercount, and a rewrite never un-masks a row, the new text being the stored text read once more by a subtractive reading (it can add a term, a value the stored row held only escaped or split by a sequence: Task 1's residuals). The existing node step heals gists, topics, refs and `nodes_fts`. No schema change, no new meta key, no new step, and grep answers throughout (D-5746). The walk's redaction reads each row twice: 1.9 to 2.0 times the base's time, measured. The task amends spec §6.2 (one sentence of "The belt's state" and a new bullet, "Which rows a belt generation rewrites"). Its pins: the pure comparison cases in `history-lib.test.ts`, the in-process re-derivation count in `history-ingest.test.ts`, and the end-to-end re-clean through the scheduled ticks in `history-maint.test.ts`.
- **Task 3.** The operator relay reads each SOURCE stream through a look-behind window of `RELAY_LOOKBEHIND_BYTES` = 16384 bytes, with a standalone pass that runs FIRST and whose marks the context reading keeps (R4, as amended by the coordinator on Task 3's measurement and restated on review finding 11). `redactAfter(lookBehind, text, idx)` is the window's one pure reading; `opRelay` and `runOpVerb` keep one window per source stream, stdout's complete lines go out as one batch per data chunk, and the stderr spill uses the same window. A JSON value on the line after its key, and a PEM body after its BEGIN line, are masked (D-5747). Against the per-line reading (each line redacted alone by `redactFinalLines`, as the per-line relay before it did), every piece the relay writes is text that reading prints, on a line the window's line breaks allow, so a value a line read alone masks is written only where another line of the same batch, read alone, prints the same characters (a named residual). That rests on R4's fallback, the line-aligned union, which the coordinator accepted on 2026-10-19: `redactAfter` unions the window's reading with the batch read one line at a time, writing a mark over every piece of it the per-line reading does not print where that piece can lie, because one batch can hold a PEM block whose mark runs to an END line and takes the next line's NAME in, which no rule change closes. The union also closes review finding 11 for the relay: a JSON key and its next pair in one batch, which the batch read as one text prints, are written as one mark from the key on. The window's reading and the per-line reading are Task 1's composed doors (R11), so the per-line reading masks every value the base's per-line relay masked, by construction. A property case over every two- and three-line batch of JSON, `NAME:`, `NAME=`, colon-led and PEM fragments pins it. The task amends spec §8.4's relay sentence, binds `RELAY_LOOKBEHIND_BYTES` in `single-definition.test.ts`' O14 `VOCABS`, and replaces `history-cli.test.ts` H-32's source pin on the per-line emit.
- **Task 4.** The op marker carries D-5016's process identity (R5): `<verb> <pid> <start_ms> <proc_start> <boot_id>`, written through `formatOpMarker`, parsed by a widened `parseOpMarker` (which answers `{ verb, pid, startMs, procStart, bootId }`; the parsed start keeps its name, `startMs`), and judged live by one decision, `decideOpLive`, in both the stale-marker removal and status. A legacy three-field marker stays readable for the rollout window, live by the kill probe with EPERM read as NOT live. `shared/lifecycle.ts`' `history-store-id` tier and spec §9.4's row state op's new bound (at most 119 B), with `pass`'s "at most 87 B" corrected to 86 in the same edit, and D-5016's entry in the B2 plan gains the same erratum (B2's item 5 (c), review 467 F4). The task also amends spec §9.6's `op-running` grammar sentence. D-5748.
- **Task 5.** `lag-high`'s remedy names the standing hold when one of D-5027's three holds stands (`snapshot-needs-op`, `refuse-low-disk`, `schema-newer`; `schema-newer` first when both), computed where `remedyFor` computes the other held remedies. With no such hold it is `HEALTH_REMEDIES['lag-high']`, unchanged (R6). No D-number.
- **Task 6.** The errata and the wave's paperwork:
  - B2's item 5 (a) and (b): D-5022's `(1 << 20) - 1` claim scoped to the read split it holds on, and `history-maint.test.ts`' "never on a pipe's size or on timing" scoped to what it is true of (review 467 F1), both worded to what Task 3's relay does; the stale-stamp window named, as text only, in `lib.mjs`'s D-5027 comment and D-5027's entry (review 467 F3, R7). Item 5 (c), the 87-to-86 erratum, is Task 4's;
  - B3's two: `single-definition.test.ts`' "512-character path bound" is 512 bytes; "only a FIFO changes the verdict" gains "(or a device node, which only root can plant)" in B3's plan, in D-5063's entry and in `session-hook.test.ts`' FIFO rows' comment;
  - the spec's one sentence for Task 5, in §9.6's `lag-high` bullet, citing D-5027 bare; a check of the §9.4 tokens Task 4 wrote (it writes nothing there); and one §17 revision-history line naming D-5745, D-5746, D-5747 and D-5748, only if the spec at the worker's base carries a §17 line for wave 5h-1;
  - the whole-PR checks and the PR body.

Sessions see no change: the hook, `ccd` and the wire are untouched. The rollout to each session-hosting node, and the reindex's first run on a live store, are coordinator or operator steps named in the PR body, never the worker's.

**Architecture:** Fleet-side only. There is no wire, server, PWA, hook, `ccd/ccrc`, `ccd/ccd` or deploy change. Doctor's bash (`ccd/ccrc-doctor-checks`) already relays the status envelope's health words and remedies and needs no edit. Ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only, `:23`) makes every decision:
- the named value rule's field arm in `contextRules` (`:1934`, the `namedValue` sticky pattern at `:1945`), with `namedSpans` (`:2013`) and `tailHead` (`:1962`) taking the span from the value group's own length; the frozen rev 3.6 rules `BASE_RULES` beside `CONTEXT_RULES` (`:1953`); and R11's composition: each door's body over one rule set, `DOOR_READINGS`, `composeDoor` and the test seam `redactDoorReadings`, beside the doors (`:2470-2720`, `:6618`, `:7318-7345`) (Task 1);
- `BELT_VERSION` (`:6098`) and the composition's owed hit in `composeDoor`, through `beltHit` (`:6436`) (Task 2);
- `RELAY_LOOKBEHIND_BYTES` and `redactAfter`, beside `redactFinalLines` (`:2685`) (Task 3);
- the op marker's one grammar and its liveness: `formatOpMarker`, `parseOpMarker` (`:3202`) and `decideOpLive`, beside `decidePassLive` (`:3269`) (Task 4);
- `lag-high`'s held remedy, in `remedyFor` (`:3437`) or wherever 5h-1 left the held remedies computed (Task 5).

*L3 `ccd/history/store.mjs`* stays the sole `node:sqlite` importer and is not edited. Its `blobs_fts` is contentless (`:1079`), which is why stored index text needs a re-derivation from each blob's bytes rather than an `UPDATE`.

*L4* delivers without deciding:
- `ccd/history/cli.mjs`: `opRelay` (`:1438`) and `runOpVerb` (`:1561`) apply the window per source stream (Task 3); status's `env.op.alive` (`:206`) comes from `decideOpLive` over `measureOpProcess(m.pid)` (Task 4);
- `ccd/history/sweep.mjs`: `writeOpMarker` (`:6198`) writes the identity through `formatOpMarker`, the new `measureOpProcess(pid)` measures the identity and the kill probe's word, and `removeStaleOpMarker` (`:6189`) removes a marker unless `decideOpLive` answers live (Task 4). `rederiveFts` (`:5960`) is Task 2's consumer and is not edited;
- `ccd/history/derive.mjs`: `beltNodesStep` (`:1284`) is Task 2's node consumer and is not edited.

*L0 `shared/lifecycle.ts`* imports nothing. Task 4 edits one string in it, the `history-store-id` tier.

No schema migration (the store stays v2), no new store table, column, index or meta key, and no new derivation step. `fts_belt`'s grammar is unchanged: Task 2 changes only the version it records.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `RegExp` sticky (`y`) scans with lookaheads, linear by construction; `node:sqlite` FTS5 through the existing belt generation; `node:child_process` pipes for the operator relay; `process.kill(pid, 0)` and its `ESRCH`/`EPERM` codes, and `/proc/<pid>/stat` field 22 plus `/proc/sys/kernel/random/boot_id` through the existing `procIdentityOf` (`sweep.mjs:3888`);
- vitest in `server/`, in-process with fixture HOMEs, plus the stand-in shim of `history-maint.test.ts`' relay cases where Task 3 reuses it.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6. Line numbers below were measured at `bd363a76b` and are hints only; 5h-1 amends §6.1, §8.4, §9.2, §9.6, §9.10, §9.14 and §9.15 in place before this plan runs, so re-anchor by content. Each spec edit is made by the task that owns its departure, in that task's commit. The sections this plan amends, each sentence citing its D-number:
- §6.2 "The belt" (`:927`): one sentence appended in "The belt's state" (`:931`), a change to a layer-2 value class bumps `BELT_VERSION`; and one new bullet, "Which rows a belt generation rewrites", above "When a belt generation opens, and when it restarts" (`:937`): a generation rewrites the rows whose composed index text differs from their rev 3.6 reading, the stored text on a store a BELT_VERSION 1 build wrote, and a later generation rewrites them again with the same text (Task 2, D-5746);
- §8.3 "Output" (`:1536`), layer 2's context bullet "the value after `NAME=`, `NAME: ` or `"name": "`" (`:1607`): what the value is and where it ends, and that every output path reads the widened rules over the rev 3.6 path's output (Task 1, D-5745, R11);
- §8.4 "Verbs" (`:1705`), the relay sentence "The CLI relays stdout line by line as it arrives" (`:1742`): the per-source window, its size and its two residuals (Task 3, D-5747). 5h-1 edits §8.4's "Carry before the verb" (`:1776`), a different sentence;
- §9.4 "Lifecycle rows" (`:2153`), the `history-store-id` row (`:2162`): op's bound, and 86 B for `pass` (the erratum, no number), with the ruling cell's removal clause (Task 4, D-5748);
- §9.6 "Doctor `history` check" (`:2231`), `op-running`'s grammar sentence "writes `<verb> <pid> <start_ms>` there" (`:2245`): the five-field marker, the legacy form, and the liveness rule (Task 4, D-5748). 5h-1 adds rows to §9.6; this is a separate hunk;
- §9.6's `lag-high` bullet (`:2258`): one sentence, what `lag-high`'s remedy names on a held node (Task 6, for Task 5; D-5027 cited bare, no number);
- §17 "Revision history" (`:3468`): one line naming D-5745, D-5746, D-5747 and D-5748 one by one, written by Task 6 only if the spec at the worker's base carries a §17 line for wave 5h-1 (otherwise none).

§9.6's stale-stamp sentence (`:2257`) already states the window, and §17 (`:3551`) already records the 87-to-86 erratum as carried, so neither is a departure.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`, "Owed from B2" and "Owed from B3" (wave 5h). Every item maps to a task:

| Item | What is owed | Task |
|---|---|---|
| B2 1 | Value classes ending at `"`, `'`, `&`, `;`, `,` (D-5021's residual), widened with a reindex plan | 1 (the rule), 2 (the reindex) |
| B2 2 | The operator relay's multi-line reading with a per-stream look-behind window (D-5022) | 3 |
| B2 3 | The op marker's process identity (D-5016's identity, D-5026 residual (i)) | 4 |
| B2 4 | `lag-high`'s remedy names a standing hold (D-5027) | 5 |
| B2 5 | Errata: (a) `(1 << 20) - 1` and "never on timing" (review 467 F1); (b) the stale-stamp window (F3); (c) "at most 87 B" is 86 (F4) | 6 ((a), (b)); 4 ((c): the tier, spec §9.4's row and D-5016's entry, in one edit with op's bound) |
| B3 1 | "512-character path bound" is 512 bytes | 6 |
| B3 2 | "only a FIFO (or a device node, which only root can plant) changes the verdict" | 6 |

B2's item 6 stays later (R9; "Not in this plan"). The B4 items are wave 5h-1's. The ledger is the coordinator's file; no task edits it.

The redaction defaults (R1, R2, R3) stand under the operator's directive of 2026-10-19, "proceed through the remaining build waves without stopping unless you're blocked by something": the scope put four questions to the operator (the exact widening, the single quote, the header classes, sweep phase or operator op), and the coordinator took each at the scope's recommended default in the operator's place. The operator did not rule them. The PR body names each so the operator can change it.

**Base:** `main` after wave 5h-1's PR merges (R8). The worker's brief names 5h-1's merge commit, and Task 1's Step 0 checks that it is an ancestor of `HEAD` before any edit. Every `file:line` in this plan was measured at `bd363a76b` (scope measured at `e4936efab`; between the two, of the files this plan touches, only `ccrc-doctor.test.ts` and `single-definition.test.ts` moved). 5h-1 then edits:
- `lib.mjs`: `HEALTH_WORDS`, `deriveHealth`, `HEALTH_REMEDIES` and `remedyFor` (three new words and their remedies);
- `sweep.mjs`: the export path;
- `cli.mjs`: `readStoreExtras`;
- the spec's §6.1, §8.4, §9.2, §9.6, §9.10, §9.14 and §9.15.

Where a task touches one of those regions it says so, anchors by quoted content, and keeps its edit a separate hunk. No task here depends on a name 5h-1 adds. Before editing a B1–B4 or 5h-1 function in place, re-read the merged code at the base: a plan text is never ground truth.

**PR:** One PR, executed in task order, one commit per task (Task 6 makes three: B3's errata, B2's errata, the spec). Task 2 consumes Task 1's `composeDoor` and `redactDoorReadings`, and re-expects the frozen `BELT_VERSION` pin that Task 1 leaves alone; Task 3's relay reads Task 1's composed `redactFinalLines`, and its figures were measured with it, so it runs after Task 1; Task 6's relay-cap erratum follows Task 3's change to the same `spillErr` code and is worded to it; Task 6's spec step only checks the §9.4 tokens Task 4 wrote; every other task stands alone.

## Global Constraints

- **Schema v2, no migration.** No new table, column or index in `history.db`, no `SCHEMA_ADDED` entry, and no new store meta key (R3). The only persistent change is the version `fts_belt` records, through `BELT_VERSION` = 2 (Task 2); `formatBeltState`'s grammar is unchanged. The op marker's file (`~/.ccrc/history/op`) changes its line, not its path (Task 4).
- **Files this PR never edits:** `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, anything under `deploy/`, `.github/workflows/*`, `README.md`, `CLAUDE.md`, `ccd/history/store.mjs`, `ccd/history/derive.mjs`, and every `shared/*.ts` but one: **`shared/lifecycle.ts` IS edited, by Task 4 only**, in the `history-store-id` row's `tier` string (`:65`). No task creates a test file, so `ci.yml`'s node-floor heredoc (`:915-933`) is unchanged; it already lists every history suite this plan edits. `lifecycle.test.ts`, `ccrc-doctor.test.ts`, `session-hook.test.ts` and `single-definition.test.ts` are not history suites and need no entry there. A worker who finds a new file unavoidable adds it to that heredoc when it is a history suite, in the same commit, and records the departure.
- **Rings by imports.**
  - `lib.mjs` is L1 and imports only `node:crypto` (`:23`). It decides: the value rule, the composition and its owed hit, the window's arithmetic, the op grammar, op liveness and `lag-high`'s remedy.
  - `store.mjs` is L3 and is not edited.
  - `sweep.mjs`, `cli.mjs` and `derive.mjs` are L4. They measure (`procIdentityOf`, the kill probe's code, the relay's bytes) and act on lib's answers; none of them decides liveness or a redaction span.
  - `shared/lifecycle.ts` is L0 and imports nothing; Task 4 adds no import to it.
- **No overloaded null.** No adapter narrows a distinction it received:
  - `parseOpMarker` answers `null` for a malformed line and a record with `procStart` and `bootId` both `null` for a legacy three-field line: two conditions, two values.
  - `decideOpLive`'s `measured.kill` keeps three words, `'ok'`, `'esrch'` and `'eperm'`; the caller never folds `EPERM` into either of the others before lib sees it. A `measured.procStart` or `measured.bootId` of `null` (unmeasurable: no `/proc`, another PID namespace) is not a mismatch's value, and for an identity-bearing marker both read as not live, with no fallback to the kill probe (R5).
  - An empty quoted value (`KEY=""`) is no value, never a value of length zero that masks the closing quote (R1).
- **Entry guards.** `sweep.mjs` (`:8807`) and `cli.mjs` (`:1668`) end in `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. Every new block goes above that guard, and there is no top-level await. `lib.mjs` has no guard: a new export goes beside the function its task's **Files** names, and a constant an existing export reads at load time goes above its reader. Each new export is declared exactly once in `lib.d.mts`; `parseOpMarker`'s declaration (`lib.d.mts:362`) is widened in place, not declared twice. `skipLibCheck` hides a duplicate, so count them.
- **Single definition.**
  - `RELAY_LOOKBEHIND_BYTES` is declared once, in `lib.mjs`, and joins `VOCABS` in place in `single-definition.test.ts`' O14 describe ("every vocabulary is declared once, in lib.mjs", `:5228`), as B3's and B4's constants did (Task 3). 5h-1 adds its own constants to the same list: keep both sides.
  - `BELT_VERSION` stays declared once (`lib.mjs:6098`); every pin but `history-lib.test.ts`' frozen-contract pin (`:6439`, Task 2) reads it symbolically.
  - The v1 value class `` [^\s"'`,;&] `` is spelled as at the base: in `TOKEN_BREAK_RE` (`/[\s"'`,;&]/`, its complement) and in `contextRules`' one `namedValue` template, which builds the final form's class, `` [^\s"'`,;&\\<>] ``, and, with `base` true, `BASE_RULES`' field class (Task 1). The rev 3.6 rules are built once, as `BASE_RULES`, from that template, never re-spelled; the only new value class is `NAMED_VALUE_FIELD_SRC`'s (Task 1).
  - The op grammar is written only by `formatOpMarker` and read only by `parseOpMarker`; liveness is decided only by `decideOpLive`. After Task 4 no shipped file decides op liveness from `kill(pid, 0)` alone: the two `pidAlive` copies (`cli.mjs:147`, `sweep.mjs:6173`), which read `EPERM` as alive, are deleted, with `sweep.mjs`' caller-less `readOpMarker`.
  - `lag-high`'s held text is never a second copy of a hold's remedy: Task 5 returns that hold's own remedy.
- **Seams.** Test seams are `ctx.deps` members or function parameters (D-4247), for example a relay seam that hands `runOpVerb` a stand-in shim, as `history-maint.test.ts` already does. Shipped code reads no new env var, flag or file to arm one, and the `process.env` allow-list stays `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION`.
- **FIXTURE HOMEs only.**
  - Tests use `historyHelpers.ts` (`makeHistoryBox`, `mkTmp`, `skipOnDarwin`), with `tmux`, `claude` and `gh` poisoned and `CLAUDECODE`, `CLAUDE_CONFIG_DIR`, `TMUX`, `TMUX_PANE` and `CCRC_RECALL_*` scrubbed.
  - No step runs `ccd`, `ccrc`, the history shim, `sweep.mjs`, `cli.mjs`, any `ccrc history` verb or any `--op` against the live `$HOME`, and no step touches `~/.ccrc`, tmux, units or any account home. The reindex is never run on a live store by the worker.
  - Sweep, relay and status tests skip on darwin, as their describes already do (`history-op.test.ts:28`, `history-maint.test.ts:104` and `:317`, `history-cli.test.ts:90` and `:582`). Lib and lifecycle tests run there, so Tasks 1–5's pure cases must pass on macOS: `decideOpLive`'s table takes `measured` as data and reads no `/proc`.
  - A test that names a live pid uses `process.pid` or pid `1`, never a pid it did not start, and kills only a child it spawned. Never kill a process by pattern.
- **Running tests.** Run from `server/` as `./node_modules/.bin/vitest run test/<file>.test.ts`, in the foreground, with a timeout of at least 600000 ms, and never with bare `npx vitest`. CLAUDE.md's load flakes are re-run in isolation before a red is called a break. `ccrc-doctor.test.ts` runs with `-t` slices.
- **Filters.** vitest compiles a `-t` filter with `new RegExp(pattern)` and matches it against the full name. Filters here use no metacharacter except a deliberate `|` alternation or an escaped one; a case title that holds `(`, `)`, `[`, `.`, `?`, `+` or `*` is selected by a plain substring of it that holds none. Each step states what its filter selects (`vitest list … -t '<filter>'`). A run that reports only skipped tests selected nothing: the filter is wrong, and the step is not green.
- **Fixtures.** Key-shaped fixtures (anything a secret scanner or push protection would read as a credential, a PEM `BEGIN … PRIVATE KEY` line included) are assembled at runtime from parts, never written whole, in the test and in the plan text alike. Secret values in the redaction cases are synthetic (`abc&def`, `hunter2xyz`, `s3cr;et`).
- **Never on timing.** A relay case that needs a key and its value in separate chunks orders them with a marker file and a bounded wait on a go-file, as the cap pins do (`history-maint.test.ts:662-700`); no assertion reads a duration. Task 1's linearity pin follows `history-lib.test.ts`' existing linear-time cases (`:1686`, `:2352-2355`): a generous bound far above the measured cost, so it reds on a quadratic regression and never on load. Cost figures are measured and reported, not pinned.
- **Red-first.** Every guard is pinned red-first: watch the test fail on the unguarded code, then measure each mutant red after the guard lands, then green again. Scratch copies go under `.superpowers/sdd/history-w5h2/scratch` (gitignored), never `git stash`.
- **Node floor.** `>=22.16.0`, identical in `server/`, `agent/` and `pwa/`'s `engines` and pinned by `node-floor.test.ts`. No task changes it; if that test reds, raise the engines, never lower them.
- **Public repo.** No hostnames, user, account, wrapper, lane or home names, pool names, session ids, IP addresses, absolute home paths, private ticket ids or docserver URLs, in plan text, fixtures, comments, commits or the PR body. Fixture paths are synthetic, in the `/home/u/tree` style.
- **D-numbers.** This plan's departures were issued by the allocator.
  - This plan's own numbers are D-5745 (Task 1), D-5746 (Task 2), D-5747 (Task 3) and D-5748 (Task 4), and no other. Two more numbers were issued in the same block and stay unassigned ("Deviations found" says which). Tasks 5 and 6 take none.
  - Each is defined exactly once, in this plan's "Deviations found", in the em-dash form (``- **D-N** — `slug` (Task k): …``). Those entries were written with the plan, so they are on the base when the worker starts: a task cites only the number its own text names, checks that its entry is there once, and never adds a second definition. A task edits its own entry only to correct a figure its own measurement changed.
  - Never write a number that was not issued, and never write a range: cite each number on its own.
  - Earlier plans' numbers are cited bare (among them D-4247, D-4347, D-4613, D-4614, D-5016, D-5017, D-5021, D-5022, D-5024, D-5026, D-5027 and D-5063; the list is not exhaustive), or as "B2's D-N" where the owner helps the reader; the namespace is global, and they are never defined here. Two tasks edit an earlier plan's entry BODY in place and keep each entry's `- **D-N** —` head, so `deviation-refs.test.ts` sees no new definition: Task 4 appends one sentence each to B2's D-5016 and D-5026 entries (Step 11 (d)), and Task 6 edits B2's D-5022 and D-5027 entries and B3's D-5063 entry.
  - A departure this plan does not list takes a number only from a block the coordinator names in the brief; otherwise the worker writes `D-TBD-<slug>` and reports it.
  - Existing `D-N` refs in source comments are history: read them, never delete them. Where a task changes the behaviour a comment describes (D-5021's residual in `contextRules`' docstring, D-5022's per-line relay in `cli.mjs:1355-1365` and `:1414-1436`, the op grammar's comment at `lib.mjs:3200`), it appends the new reading and keeps the old ref.
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Order (R8).** This plan runs on a base that holds wave 5h-1's merge, which the coordinator's brief names. Tasks 1, 2, 3 and 5 edit `lib.mjs` near or inside 5h-1's regions (`HEALTH_WORDS`, `deriveHealth`, `HEALTH_REMEDIES`, `remedyFor`); Task 4 edits the spec's §9.6, which 5h-1 also edits. Each re-anchors by content on that base and keeps a separate hunk. Task 1's Step 0 runs `git merge-base --is-ancestor <5h-1's merge commit> HEAD`; if the base does not hold 5h-1, stop and report to the coordinator before Task 1's first edit.
- **Peers.** Before each first edit of an existing file, the worker reads `GET /api/claims?project=ccrc-pwa`. The hot files are `ccd/history/*.mjs`, the history tests, `single-definition.test.ts` and the spec. At `bd363a76b` the public-tree clean-up run held claims on `single-definition.test.ts` (keep off `:917-939` and `:1811-1831`) and on the spec (keep off `:34-54`, `:118-138`, `:2900-2920` and `:3013-3033`); none of this plan's anchors falls in those ranges. If a claim still stands, edit only beside it, and whichever PR lands second merges `main` (never a rebase) and keeps both sides.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| R1 | **The named value class widens in its FIELD form only; the final form's named value class is unchanged** (D-4613's structure safety). A quoted value (`"` or `'`) is read to its closing quote on the same line, and an empty quoted value counts as no value. An unquoted value still ends at whitespace and the backtick; `&` ends it only before `NAME=` (a `[A-Za-z_][A-Za-z0-9_.-]{0,255}=` lookahead); `,` `;` `"` and `'` end it only before whitespace, a closer (`,` `;` `)` `}` `]`) or the end of the text. So the single quote is a quote like `"` (D-5021 left it open). This is the prototype the scope measured green: linear on 1 MiB adversarial inputs, idempotent on its own output, every recorded leak masked whole, every structural control unchanged. `namedSpans` and `tailHead` take the span from the value group's own length. **Reverted by R11 to that prototype** (the coordinator, 2026-10-19): the plan's third review had added v1's named reading unioned into the field pass and an opening quote admitted before a closer, and its fifth a backslash that a quote follows ending an unquoted value, each to close a shape where the widening, read over the raw text, printed a value the base masked; R11 closes those shapes by construction, so the three patches are withdrawn. Under R11 the recorded leaks are still masked whole and the structural controls print as before (measured); the widening lost to composition is a named residual (D-5745). | taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger); the operator may change it; amended by R11 (reverted to the prototype, 2026-10-19) | 1 |
| R2 | **The Bearer and box-token header classes stay as they are** (`lib.mjs:1946-1949`). An RFC 6750 b64token and the hex box token never hold a quote, and a closing `"` after a header value (`-H "Authorization: Bearer x"`) is the common real case. | taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger); the operator may change it | 1 |
| R3 | **Stored text is re-cleaned as a SWEEP PHASE, not an operator op.** `BELT_VERSION` goes from 1 to 2, and the belt generation rewrites only the rows the widening changes. **As R11 amends it:** the walk rewrites a row exactly when the composed door's index text differs from its rev 3.6 reading (the stored text, on a store a BELT_VERSION 1 build wrote), and every later re-derivation, a pair-owed walk or a roll-forward after a rollback included, rewrites those rows again with the text they already hold. Under a re-derivation probe, `composeDoor` counts an owed hit when a door's v2 reading changes its base reading's text, which is the rev 3.6 door's, the text a BELT_VERSION 1 build stored; so it can never un-mask a stored row (the new text is the stored text's v2 reading, which only masks; it can add a term, a value the stored row held only escaped or split by a sequence, D-5745's residuals), and it cannot undercount against the comparison, being the comparison. It replaces the rule-hit probe the plan first wrote (a widened-value predicate, and a count for a JSON-form key rule the coordinator withdrew). No schema change, no new meta key, no new step; grep stays available throughout, old rows serving until they are rewritten. `doctor --repair` stays the operator's manual alternative and is not the path. The walk's redaction reads each row twice (measured 1.9 to 2.0 times the base's time), so the scope's estimate for a store of about 2 GB, roughly 4–13 min of CPU over about 8–40 two-minute ticks, becomes at most about twice that: an estimate, not a measurement of the live store. | taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger); the operator may change it; amended by R11 (the walk compares, 2026-10-19) | 2 |
| R4 | **The relay reads each SOURCE stream through a look-behind window** of `RELAY_LOOKBEHIND_BYTES` = 16384 bytes; the stderr spill uses the same window. **Amended by the coordinator on review finding 11, against the per-line reading:** the relay never prints a value that `redactFinalLines` would mask reading each line alone (the relay before this wave redacted stdout one line at a time), and it is never less masked than `redactFinalLines` over the same batch. As ruled, should an input be found that no rule closes, the fallback was to union the per-line, batch and context readings, or to stop and mail the coordinator first, and never to ship the batch relay with a known per-line regression. **The plan's second review found one** (one batch holding `zqx26 <BEGIN line>` and `TOKEN=<BEGIN line>abc<END line>V`: the first BEGIN line's mark runs to the END and takes `TOKEN=` in, so V prints, where that line read alone masks it), so Task 3 writes the union: `redactAfter` unions the window's reading with the per-line reading over the text written (a mark over every piece of the window's reading that the per-line reading does not print), since no reading of `redactFinalLines` answers spans. **The plan's third review aligned that union by line**: every piece written is text the per-line reading prints, on a line the window's line breaks allow, so a value a line alone masks is written only where another line of the same batch, read alone, prints the same characters (a named residual, beside the union's availability losses). The union also closes review finding 11 for the relay (a JSON key and its next pair in one batch are written as one mark from the key on). **The window's reading uses the composed doors** (R11), so the per-line reading masks every value the base's per-line relay masked, by construction (measured: 200,000 random batches, 0 printed). The second guarantee holds because the standalone pass runs FIRST and the context reading keeps its marks (**amended by the coordinator on Task 3's measurement**: a final standalone pass is measurably insufficient, a PEM block the look-behind opens taking the batch's NAME into its mark). D-5747's entry records both amendments. Windows are keyed by source stream, never by destination (under `--json` both shim streams reach the CLI's stderr, unordered against each other). Residuals, named: a shape longer than the window, and a key at the end of a long line that a shorter line follows in its batch; text already printed before its key line; a value cut exactly at a mid-line stderr seam, read as two lines; the window's raw text in process memory; the union's own three (Task 3's Residuals, which D-5747 lists in full); and the held stderr's flush cost, read one line at a time (memoised by line), which the signal handler spends before its 2 s bound is armed (the plan's seventh review). | ruled by the coordinator (line-aligned union accepted 2026-10-19); amended on Task 3's measurement and on review finding 11 | 1, 3 |
| R5 | **The op marker carries D-5016's process identity:** five fields, `<verb> <pid> <start_ms> <proc_start> <boot_id>`; the parsed start keeps its name, `startMs`. A legacy three-field marker is accepted as legacy during the rollout window: live by the kill probe, where `EPERM` reads as NOT live (the fleet is one UNIX user). An identity-bearing marker is live only when both `procStart` and `bootId` match; there is no fallback to the kill probe on a mismatch. On a box without `/proc` (darwin test boxes), the op marker is written in the legacy three-field form and judged by the kill probe; removing legacy acceptance also retires that writer arm (added by the coordinator on review finding 10). | ruled by the coordinator | 4 |
| R6 | **`lag-high`'s remedy names the standing hold for D-5027's three holds only:** `snapshot-needs-op`, `refuse-low-disk` and `schema-newer`, `schema-newer` first when both stand. `at-cap` and the low-disk capture pause are NOT added: each already reports its own word (`at-cap`, `capture-paused-low-disk`, `lib.mjs:3639-3640`) with its own remedy. No D-number. | ruled by the coordinator | 5 |
| R7 | **B2's stale-stamp window (D-5027) stays text only,** as review 467 ruled: no `heldFresh` code guard. A `held_pass_ms` written before the store became newer holds `tick-stale` back for up to `TICK_STALE_MS`; the D-5027 comment and entry say so. | ruled by the coordinator | 6 |
| R8 | **Order: this plan executes after wave 5h-1 (run 626) merges.** Both edit `lib.mjs`'s `deriveHealth`, `HEALTH_REMEDIES` and `remedyFor` regions; the worker re-anchors by content on `main` after 5h-1 and keeps separate hunks. | ruled by the coordinator | all |
| R9 | **B2's item 6 stays later:** strict O(owed), D-5017's ineligible-when-written state and D-5024's pinned-cursor rescan. The only measurement that could ask for them is a read of the live store, which is the operator's. | ruled by the coordinator (the live read stays the operator's) | — |
| R10 | **(Withdrawn.)** A JSON-form key rule: a quoted string that is itself a secret NAME, with a colon after it on its line, read as the next pair's key, never as the value of the key before it. It was ruled on review finding 11, narrowed after the plan's second review and unioned with v1's reading at its fourth. Under R11 the relay's per-line union (R4, D-5747) closes finding 11 for the relay, and the rule's every amendment had measured a new way to print what the base masked; its code, pins and mutants are removed. The shape it addressed, read as one text, is a pre-existing residual of the field door, `redactFinalLines` and the index and display doors (D-5745's entry). | withdrawn by the coordinator (composition, 2026-10-19) | — |
| R11 | **Every redaction door of this build is the v2 rules applied over the BASE door's output: `newDoor(text) = v2Door(baseDoor(text))`.** `baseDoor` is the exact rev 3.6 door, its rules kept in `lib.mjs` as a frozen module-private rule set, spelled once (`BASE_RULES`, from `contextRules`' one template); `v2Door` is the same door built from the widened rules. It holds for `redactField`, `redactFinal`, `redactFinalLines`, `redactFinalJson`, `redactFinalText`, `redactForIndex`, `redactForDisplay`, `entryIndexText`, `sidecarIndexText`, `redactDisplayWindow` and `displaySnippet`, and through them for `nodeIndexTexts`, the `--regex` child, the node fields and the relay. The premise, stated and pinned: every door is SUBTRACTIVE (its output is its input, a JSON-escape decoding of it, or its input with escape sequences removed, which is D-4307's joined reading, with spans replaced by the mark; it writes no character its input did not hold, but marks and notes), so `v2Door` can never write back a value `baseDoor` masked, a masked value being one that no reading of `baseDoor`'s output holds (as written, decoded, or with its sequences removed). Removing a sequence glues the text either side of it, so a value `baseDoor` printed split by a sequence can print whole (a named residual, D-5745; the plan's sixth review); likewise, where `v2Door` finds a value only at a JSON-decoded level, the index and display doors return that level, so a value `baseDoor` printed only escaped prints decoded (a named residual, D-5745; the plan's seventh review). Pinned by a property case over f2Cases, the reviews' shapes and two seeded corpora, one of them of colour sequences (no value the base door masks appears in any reading of the new door's output, 0 by construction), one case, (j9), that checks composition and subtractiveness for every door, and a mutant that runs `v2Door` on the raw text (red). It amends R1 (reverted to the prototype; the round patches withdrawn) and R3 (the walk compares the composed text with the stored one), withdraws R10, and accepts R4's line-aligned union. The display doors compose before the cut by a token union over the base door's cut (D-6071): ruled on review 711 F1 in the literal form, substituted by the worker as measured, and confirmed by the coordinator on review 721, in the operator's place under the build directive. Cost: about two passes of each door (measured 1.9 to 2.0 times). | ruled by the coordinator (2026-10-19) | 1, 2, 3 |

## Review Focus

These five inputs follow from the spec and would bite an operator, and no case the scope measured exercises them. Each names the task that pins it, and, where that task's cases do not reach the whole input, what the reviewer probes.

1. **A quoted value whose quote arrives escaped or never closes, and the composition's premise.** JSON-serialised text carries `password=\"a b\"`, and a shell line can carry `password="abc` with no closing quote on its line. Neither takes R1's quoted arm. Expected: no door prints a value its rev 3.6 door masks, the final form's structure is unchanged, and the scan stays linear on a 1 MiB run of either shape. R11 makes the first hold by construction, on one premise: every reading is subtractive (its output is its input, a JSON-escape decoding of it, or its input with escape sequences removed, with spans replaced by the mark), and a masked value is one that no reading of the base door's output holds. **Task 1** pins, in (j5), the escaped quote raw and JSON-serialised and the unclosed quote, each through the field door, `redactFinalLines`, `redactFinalJson`, the index and display doors and the final form alone (its CONTROL: unchanged from v1), and the fifth review's escaped pair behind 14 glues, the empty one among them (448 texts through `redactForIndex`, `redactForDisplay` and `entryIndexText`); the linear scan, including the one open-quoted shape whose long tail reaches the widened pattern under composition ((j8)); in (j9), that every door is `v2(base(…))` and every `v2` reading is subtractive, over f2Cases, 600 seeded texts and 300 with colour sequences; and in (j10), that no value a base door masks prints, over 44,422 such values (13,042 of them in texts with colour sequences). The reviewer probes the premise where the checker is loosest: (j9) accepts a piece found in any JSON-escape decoding of the input, read past any escape sequence it skips, so a `v2` reading that decoded a level the base did not show, and printed a value only that decoding holds (a value whose characters arrive as JSON unicode escapes), would pass it. Neither (j9)'s nor (j10)'s corpus plants such a value. The plan's seventh review did (60,000 texts with JSON-escaped NAMEs, separators and values through all eleven doors and the relay): no value the base door masks appeared in any reading of the new output, and a value the base printed only JSON-escaped printed decoded where the widened rules find a value only at a decoded level, the same mechanism as the colour-sequence residual (both Task 1's residuals, D-5745). The widening lost to composition (Task 1's residual) is availability, never a leak.
2. **A rollback across `BELT_VERSION`.** A node runs this build, opens the v2 generation, is rolled back to a build with `BELT_VERSION` = 1 (which re-stamps `fts_belt` at v1 after its own generation), then rolled forward. Expected: the forward build reopens a generation (the R-version restart), rewrites only the rows whose composed index text differs from their rev 3.6 text (beside the rows every generation rewrites), and ends with the index a fresh v2 generation gives; grep never answers exit 7 and no row is lost. **Task 2**, through its planted `fts_belt` at v1 over rows a v2 generation has already rewritten, pins what its cases assert: in process, the re-derivation reindexes exactly the one widened row and all three rows stay indexed (`history-ingest`); end to end through the ticks, the generation completes at `BELT_VERSION`, no `blobs_fts` row answers the tail, the gist and its `nodes_fts` row are healed, and one sentinel row is not rewritten (`history-maint`). No case runs `grep` while the generation is open or counts every row before and after it, so "grep never answers exit 7 and no row is lost" during the walk is argued (a belt generation never drops the index), not asserted: the reviewer probes it.
3. **A split shape on one source stream, ended early, while the other stream writes.** Under `--json` both shim streams reach the CLI's stderr. Expected: a key on shim stdout and its value on shim stdout are joined by stdout's window; a key on one stream and its value on the other are not joined (a named residual); a run ended by `onClose` writes stdout's held line and partial buffer through the same window, never through a bare per-line pass; and a run ended by `fail()` or by a signal handler flushes stderr's held text through its window and drops stdout's held line and partial buffer, as the base does (nothing of them is written, so nothing leaks). **Task 3** pins the keying (its keyed case, a PEM left open on stdout at the child's close beside a stderr line, and mutant M12) and the split shapes on one stream; every ending writes through the one emit callback, which holds the window (Task 3's Interfaces). No case of Task 3 ends a split JSON shape by `fail()`, a signal or the child's exit before its last line break, so the reviewer probes that ending.
4. **An op pass from the older build still running across `ccrc update`.** Its marker is three-field. Expected: it reads live by the kill probe, so `stateHeld` and the D-5026 hold stand until it ends and the update's doctor does not exit 3 on it; a three-field marker naming pid 1 (`EPERM`) reads not live and the next pass removes it; a five-field marker read where `procIdentityOf` answers `null` (another PID namespace, D-5026 residual (h)) reads not live, with no fallback. **Task 4**, in `decideOpLive`'s table and `history-op.test.ts`' op-marker describe (`:990`).
5. **Two holds at once, and a hold that clears.** A rollback onto a store a newer build had begun to migrate can show `schema-newer` beside a `snapshot-needs-op` verdict. Expected: `lag-high`'s remedy names `schema-newer`'s remedy; once no hold stands, the remedy is `HEALTH_REMEDIES['lag-high']`, byte for byte; `at-cap` and `capture-paused-low-disk` alone leave it unchanged. **Task 5**, through a combined row and a CONTROL row in the `deriveHealth` block's held cases (`history-lib.test.ts:4216`).

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | **Task 1:** `contextRules`' field-form `namedValue` (`:1945`) as R1's prototype (`NAMED_VALUE_FIELD_SRC`, `QUOTED_LINE_ENDS`), `contextRules`' `base` parameter and `final` flag, and the frozen `BASE_RULES`; `namedSpans` (`:2013`) and `tailHead` (`:1962`) take the span from the value group; `redactRun`, `redactLayers` and `redactLayered` take one form of one rule set; every door's body over one rule set (`…With(…, rs)`), its export as `composeDoor` over `DOOR_READINGS`, and the test seam `redactDoorReadings` (R11); `TOKEN_BREAK_RE`'s doc comment (`:7100-7101`). **Task 2:** `BELT_VERSION` = 2 (`:6098`) and its docstring; the owed hit in `composeDoor`, through `beltHit` (`:6436`). **Task 3:** `RELAY_LOOKBEHIND_BYTES`, `redactAfter` and the module-private `relayKeep`, `relayRead` (the window's reading) and `relayUnion` (R4's fallback, the per-line union), beside `redactFinalLines` (`:2685`). **Task 4:** `parseOpMarker` widened (`:3202`; its answer keeps `startMs`), with `formatOpMarker` and `decideOpLive` directly after it. **Task 5:** `lag-high`'s held remedy in `remedyFor` (`:3437`), through the module-private `schemaNewerOf` and `lagHoldOf` above it, and `deriveHealth`'s `schema-newer` line (`:3642`) reading `schemaNewerOf`; `HEALTH_REMEDIES['lag-high']` (`:3386`) stays the default text. **Task 6:** the D-5027 comment over `heldFresh` (`:3601-3608`) names the stale-stamp window. | L1 | 1, 2, 3, 4, 5, 6 |
| `ccd/history/lib.d.mts` | modify | One declaration per new export: `redactDoorReadings` (Task 1), `RELAY_LOOKBEHIND_BYTES` and `redactAfter` (Task 3), `formatOpMarker`, `decideOpLive` and the `OpMarker` and `OpMeasure` interfaces (Task 4); `parseOpMarker`'s one line (`:362`) replaced in place, its answer `OpMarker` (`startMs` kept, `procStart` and `bootId` added). | types | 1, 3, 4 |
| `ccd/history/cli.mjs` | modify | **Task 3:** `opRelay` (`:1438`) emits stdout's complete lines per data chunk; `runOpVerb`'s emit wrapper (`:1585`) keeps one window per source stream; `flushErr` and `spillErr` (`:1459`, `:1468`) go through stderr's window; the comments at `:1355-1365`, `:1414-1436` and `runOpVerb`'s doc (`:1558-1560`) append D-5747. **Task 4:** status's `env.op.alive` (`:206`) from `decideOpLive` over `measureOpProcess(m.pid)` (imported from `sweep.mjs`), `start_ms` still from `m.startMs`; `pidAlive` (`:147`) deleted. All above the entry guard. | L4 | 3, 4 |
| `ccd/history/sweep.mjs` | modify | **Task 4:** the new export `measureOpProcess(pid)`; `writeOpMarker` (`:6198`) writes through `formatOpMarker` with `procIdentityOf(process.pid)`, and still throws on a failed write (H-101); `removeStaleOpMarker` (`:6189`) removes a marker unless `decideOpLive` answers live; `pidAlive` (`:6173`) and the caller-less `readOpMarker` (`:6183`) deleted. Not edited by Task 2: `rederiveFts` (`:5960`) consumes the composition's owed hit as it is. All above the entry guard. | L4 | 4 |
| `shared/lifecycle.ts` | modify | The `history-store-id` row's `tier` (`:65`): op's bound (at most 119 B) and `pass` at most 86 B, in one edit; one clause of its `ruling` (a dead or reused pid's op). The only `shared/` file this PR edits. | L0 | 4 |
| `server/test/history-lib.test.ts` | modify | **Task 1:** (j3)'s residual pin (`:2466-2485`) re-expected as a whole mask; (f)'s and (j4)'s CONTROLs read one field pass (the base reading), and (j4) gains an input that holds the final pass after both field passes; the deep-chain and entry-window cost pins (`:3336`, `:3343`, `:3488`) count a composed door's two readings; the FU1S lead-reading case's ceiling, 60 s to 120 s (`:2111`); the one-cut-rule source pins (`:3504-3509`) read the `…With` bodies; six new cases, (j5)–(j10): quoted values and the final form unchanged, over-mask CONTROLs, old output heals (and the base reading is v1's), linearity, every door `v2(base(…))` and subtractive, and no value a base door masks printed; (l)'s seeded fuzz (`:2571`) is not edited. Task 1 leaves the frozen `BELT_VERSION` pin alone. **Task 2:** the frozen-contract pin `BELT_VERSION` 1 → 2 (`:6439`), in the commit that bumps it; one describe of 23 cases: the comparison's hit, row by row and over f2Cases through both index doors. **Task 3:** one describe appended: `redactAfter`'s cases, the window's edge at `RELAY_LOOKBEHIND_BYTES` and one byte beyond, review finding 11's one-batch input, the union's one-batch PEM input (with the union's line alignment, its residual and an 8 MiB bound), and the per-line property case, 12 in all. **Task 4:** the `parseOpMarker` block's first case (`:3593-3594`) re-expected (`startMs` kept, `procStart` and `bootId` null); one describe appended: `formatOpMarker`'s round trip, the 119 B bound, `decideOpLive`'s table. **Task 5:** a nested describe of held rows in D-5027's `deriveHealth` block (`:4215`), and three inputs in the FR3-d scan's `dynamic` list (`:3840`). | test | 1, 2, 3, 4, 5 |
| `server/test/fixtures/history/f2Cases.ts` | modify | The named form's `endsAt` (`:19`) becomes R1's hard ends; the anchors' rows (`:18`, `:20`) are unchanged (R2). Shared by `history-cli.test.ts` H-32 and `history-maint.test.ts`' relay pins, which need no edit. | test | 1 |
| `server/test/history-ingest.test.ts` | modify | **Task 2:** one describe appended, in process: a store with one row replanted as a v1 row and `fts_belt` stamped v 1; `rederiveFts` answers `{ state: 'completed', reindexed: 1 }` over a widened row, a named row v1 already masked whole and a plain row. No import is added. | test | 2 |
| `server/test/history-maint.test.ts` | modify | **Task 2:** the reindex END TO END through the scheduled ticks on a fixture HOME (its pin of record): a planted `fts_belt` at v1, a `blobs_fts` row holding a widened value's tail term and a leaf whose gist holds it; after the ticks no `MATCH` finds the tail, the gist and `nodes_fts` are healed, and a sentinel row with no named value is not rewritten; the lib and sweep import lines gain `entryIndexText`, `beltWitness` and `ftsTextOfBlob`. **Task 3:** stdout's JSON and PEM shapes over lines, in one chunk and in separate chunks ordered by a go-file, human and `--json`; a split shape across the stderr spill seam; the per-stream keying; review finding 11's JSON key and next pair in one stdout chunk; a PEM block that runs into the next line's NAME, in one stdout chunk. **Task 6:** the cap-pin comment's three lines (`:666`, `:670`, `:677`). | test | 2, 3, 6 |
| `server/test/history-op.test.ts` | modify | **Task 4:** the lib import gains `procStartOf` and `bootIdOf`; the op-marker describe (`:990-1058`): the five-field shape written, an identity-equal marker kept and a reused-pid or other-boot marker removed, a legacy pid-1 marker removed, the live-vitest-pid case kept green as legacy. **Task 5:** D-5027's `verdict` helper's type gains `remedy` (`:612`, `:615`), and the F2 held-node case (`:633-638`) expects the held remedy. | test | 4, 5 |
| `server/test/history-cli.test.ts` | modify | **Task 3:** H-32's source pin on the per-line emit (`:407`, `emit(redactFinalLines(line, idx), toStderr)`) replaced by two pins on the windowed emit. **Task 4:** two cases in `describe('the pass marker (D-5016)'` (`:654`), after the D-5026 case: a reused-pid op marker gives `op.alive` false, no `op-running` WARN, and the death line FAILs `tick-stale`; a legacy marker read by the kill probe, pid 1 not live. | test | 3, 4 |
| `server/test/ccrc-doctor.test.ts` | modify | **Task 4:** the history lib import gains `formatOpMarker`, `procStartOf` and `bootIdOf`; an `ownIdentity` helper after `metaOnFreshTick`; two `STATES` rows after the dead-pid row (`:14285-14286`): an identity-equal marker WARNs `op-running`, a reused-pid marker holds nothing back. The existing three-field `prune ${process.pid} …` fixture (`:14278`) stays green as legacy. | test | 4 |
| `server/test/lifecycle.test.ts` | modify | **Task 4:** one import of `parseOpMarker` and `parsePassMarker` from lib, and one case after the `history-store-id` case (`:1137`) pinning the tier's op bound and 86 B for `pass`, tied to the grammars' maximal lines. | test | 4 |
| `server/test/single-definition.test.ts` | modify | **Task 3:** `RELAY_LOOKBEHIND_BYTES` joins O14's `VOCABS` (`:5228`) in place. **Task 6:** the comment at `:6846` says 512-byte. No import line, and no edit outside these two places. | test (citation corpus) | 3, 6 |
| `server/test/session-hook.test.ts` | modify | **Task 6:** the FIFO rows' comment (`:12624-12630`) gains the device-node parenthesis, rewrapped within the block. | test | 6 |
| `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` | modify | In-place sentences, each made by the task that owns its departure and citing its D-number: §8.3's layer-2 value and the composition (Task 1, D-5745, R11); §6.2 "The belt's state" and a new bullet "Which rows a belt generation rewrites" (Task 2, D-5746); §8.4's relay sentence (Task 3, D-5747); §9.4's `history-store-id` row and §9.6's `op-running` grammar (Task 4, D-5748, with the 86 B erratum). **Task 6:** §9.6's `lag-high` sentence (D-5027 cited bare, no number), a check of Task 4's §9.4 tokens, and one §17 line only if the base's §17 carries one for wave 5h-1. | docs | 1, 2, 3, 4, 6 |
| `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md` | modify | **Task 4:** D-5016's entry gains the erratum (86 B, not 87 B) and D-5026's entry gains that residual (i) is closed, with the tier edit. **Task 6:** D-5022's cap claim and its "never on timing" sentence scoped, and its residual closed by Task 3's window; D-5027 gains residual (d), the stale-stamp window. Body text only; each `- **D-N** —` head is kept. | docs | 4, 6 |
| `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md` | modify | **Task 6:** the `.generation` bullet (`:4934`) and D-5063's entry (`:7392`) gain the device-node parenthesis, each line kept one line. | docs | 6 |
| `docs/superpowers/plans/2026-10-19-ccrc-history-w5h2-redaction-and-ops.md` | modify only to correct a task's own entry | "Deviations found" already defines D-5745, D-5746, D-5747 and D-5748, once each, from the plan's own commit. A task checks its entry and edits it only where its own measurement changed a figure; it never adds a second definition. | docs | 1, 2, 3, 4 (only if needed) |

## Not in this plan

- **B2's item 6, "later, unless a measurement asks for them sooner" (R9):** strict O(owed), an ineligible-when-written state (D-5017), and a rescan from a pinned cursor for the leaves' `todo` and fork scans (D-5024). Wave 5h measured them on 2026-10-19 and nothing asks for them: the owed check runs only once the FTS step has completed, the rescan is bounded per pass by its budget, and live passes stayed well under the carrier's kill. The one measurement that could ask for D-5024 is a read-only query of a live store: the `leaves` cursor (`derivation_state`, step `leaves`), the count of main-transcript boundaries above it with no node and the age of the oldest, and `status --json`'s `fts`. It is the operator's to run or authorise, never a worker's. Strict O(owed) would need schema v3.
- **The operator's open restore question** (wave 5h-1's R12): whether replay takes a body over a held tombstone. No code here; bytes stay out over a held tombstone, as now.
- **Everything wave 5h-1 owns:** B4's items 1–8, that is the bounded check after a bind and its stop record, doctor's `export-marks-unchecked`, `export-marks-stalled` and `export-segment-damaged`, the whole-and-own carried segment, the vanished re-arm, last-carrier replay, `expand`'s variants and `ENTRY_UPSERT`'s tie, the history-off advice, and B4's errata (the `/bin/sh` umask wrapper and the modes case's title). This plan edits none of their code and depends on none of their names.
- **Out of scope for this wave:**
  - widening the Bearer or box-token header classes, or any change to the final form's value classes (R2, R1); and a JSON-form key rule, which the coordinator withdrew (R10, R11);
  - a forced rewrite of every indexed row, a separate rules version in `fts_belt`, or the reindex as an operator op (R3);
  - a `heldFresh` guard for `schema-newer` (R7);
  - `at-cap` or the low-disk capture pause as a `lag-high` hold (R6);
  - a relay window larger than 16 KiB, or a retraction of text already printed (R4's residuals);
  - removing the legacy three-field marker's acceptance, which waits until no node can run an older op pass (R5); removing it also retires this build's own legacy writer arm, since `writeOpMarker` writes the three-field form on a box where `procIdentityOf` answers null (no `/proc`, darwin test boxes; R5, as the coordinator extended it on review finding 10; D-5748's residual (e));
  - `delegation-spool.test.ts`' "the path bound is 512 characters" (`:1349`), which belongs to another programme's tests: at most a note to it;
  - the pointers that still call D-5024's rescan and D-5017's owed set "B3's" (`derive.mjs:502`, `history-derive.test.ts:1467`, and the two entries): R9 keeps the items later, and the ledger, not those comments, records where they stand.
- **Steps that are never the worker's.** The rollout to each session-hosting node, the reindex's first run on a live store, any real-data drill, the live read under R9, and any change the operator makes to an R1–R3 default the coordinator took in the operator's place are coordinator or operator steps named in the PR body.

---

### Task 1: the named value class reads a value whole, over the rev 3.6 door's output

B2's ledger item 1 (scope b2-redaction, item B2-1, the RULE half; the stored-text reindex is Task 2). Layer 2's named rule (`NAME=value`, `NAME: value`) reads its value with one class in both forms, `[^\s"'`,;&]`. So a value ends at `&`, `;`, `,` and either quote, and its tail prints in every door that runs the field pass. D-5021 recorded `password=abc&def` → `password=[redacted]&def`, and the scope found more: `password="abc&def"` → `"[redacted]&def"`, `export PASSWORD="s3cr;et"` → `"[redacted];et"` and `PASSWORD='a b c'` → `'[redacted] b c'`. This task widens the FIELD form's value only, as ruling R1 says, with the prototype the scope measured:
- a quoted value (`"` or `'`) is read to its closing quote on the same line, and an empty quoted value counts as no value;
- an unquoted value still ends at whitespace and the backtick;
- `&` ends it only before `NAME=` (a `[A-Za-z_][A-Za-z0-9_.-]{0,255}=` lookahead, the head's own NAME bound);
- `,` `;` `"` `'` end it only before whitespace, a closer (`,` `;` `)` `}` `]`) or the end of the text.

The final form keeps v1's class byte for byte, so D-4613's structure safety is unchanged. Because the field form now consumes the closing quote, `namedSpans` and `tailHead` take the span from the value group's own length, never from the whole match. Per R2, the Bearer and box-token header classes stay as they are, so D-5021's Bearer example stays a pinned residual. The departure is D-5745 (`history-redact-value-class-widened`).

**Composition (R11, the coordinator's ruling of 2026-10-19, which amends R1 and R3).** Two review rounds (the plan's third and fifth) found three shapes where the widened rules, read over the raw text, printed a value the base masked: a quoted value that takes a secret NAME and `: ` in and ends before the value v1 read after its closing quote (`PASSWORD="token: "V`), an unclosed quote a closer follows (`PASSWORD=")V end`), and a `NAME=value` glued to an escaped JSON pair, whose key the widened value took in, so that the index and display readings, which decode the escapes, saw no key before V (`{"text":"TOKEN=abc,\"api_key\": \"V\"}"}`). Each shape was patched (v1's named reading unioned into the field pass, an opening quote admitted before a closer, a backslash that a quote follows ending an unquoted value), and each patch left a measured residual in the doors that read twice. R11 replaces the patches with one construction: every redaction door of this build is `v2(base(text))`. `base` is the door as rev 3.6 built it, from `BASE_RULES`, the rev 3.6 rules kept in `lib.mjs` as a frozen module-private rule set and built from `contextRules`' one template (`base` true), so they are spelled once. `v2` is the same door built from the widened rules (`CONTEXT_RULES`), read over `base`'s output. The premise, stated and pinned: every reading is SUBTRACTIVE. Its output is its input, or a JSON-escape decoding of it (the index and display readings), or its input with escape sequences removed (D-4307's joined reading, which a text holding a sequence takes when that reading finds something to mask), with spans replaced by the mark (and, for an index text, cut; a display window carries its note, and a snippet's cut may fall inside a mark). It never writes a character its input, so decoded, did not hold. A value a door masks is one that no reading of its output holds: as written, decoded, or with its sequences removed. So the `v2` reading can never write back a value the `base` reading masked: no door of this build prints a value its rev 3.6 door masks, by construction. Removing a sequence glues the text either side of it, so a value the base printed split by a sequence can print whole (a residual, below). The three patches are withdrawn with the JSON-form key rule that the coordinator withdrew in the same ruling (R10).

The doors, each composed in `composeDoor` through its entry in `DOOR_READINGS`: `redactField`, `redactFinal`, `redactFinalLines`, `redactFinalJson`, `redactFinalText`, `redactForIndex`, `redactForDisplay`, `entryIndexText`, `sidecarIndexText`, `redactDisplayWindow` and `displaySnippet`. `nodeIndexTexts` (each node column through `entryIndexText`), the `--regex` child (`entryIndexText` over `blobPlainText`, which reads `sidecarIndexText`), the node fields (`derive.mjs`' `redactField`) and the relay (Task 3's `redactAfter`, over `redactFinalLines`) read those doors and are composed through them. Each door's body takes the rule set as its last argument (`redactForIndexWith(text, idx, rs)` and the like), and every internal call passes the rule set it was handed, so no reading ever calls a composed door. Three doors' `v2` readings read the base output as their own kind of input:
- `sidecarIndexText`'s is the index redaction and the cut over the base's text. Its window and its first decode are readings of the raw bytes that the base reading already took; decoded again, a JSON string held inside a JSON string would be indexed at its second level whether or not anything there is masked, which D-4343's rule refuses.
- `redactDisplayWindow`'s and `displaySnippet`'s `v2` is `redactForDisplay`'s reading of the base output, which is what a window of the whole text is (`displayWindow`'s step 0). Their composed door is not `v2(base)` (D-6071, review 711 F1): it keeps the base door's cut byte for byte and reads the widened rules over the base reading of the margin-widened text the cut was made from (`displayWindowRead`'s `read`); a token of what the cut shows that this reading no longer prints, or that `v2` over the base door's shown text no longer prints (`preRoundTokens`, review 721 item 1), becomes a mark (`composedTokens`, `maskUnprinted`: `relayUnion`'s pattern over tokens, a token being a mark or a maximal run of characters that are neither whitespace nor one of `"'`,;&`, so a word in any script and a value's punctuation are masked with it), a token the cut itself split is decided by the whole token of the reading around that edge, and a snippet masks the slice `snippetBounds` cuts from the base window text, so its cut is the base's. The result only replaces spans of the base output with marks, so it is subtractive over it, and `v2` then reads that, as before. A window of the whole text through `redactDisplayWindow` is `v2(base)`, as before; a whole-text snippet is not, because it masks its slice by tokens.
- `redactFinal`'s and `redactFinalText`'s two rule sets read the same final form, so each is its final door twice. On 60,000 fuzzed texts the second pass changed nothing (measured).

Choices below give the measurements. Residuals, named:
- **A quoted prose value after a secret NAME** is now masked to its closing quote (R1's default, taken by the coordinator in the operator's place; the operator may change it). The scope's corpus diff turned `token: "<a sentence>"` into `token: "[redacted]"`, and search loses those words.
- **The display margin** (D-6071). The widened class reads the margin, so a value whose NAME sits within `ENTRY_REDACT_MARGIN` before a display window is masked there. When the NAME sits MORE than `ENTRY_REDACT_MARGIN` before it, the window can show part of the value: spec §8.3's existing display residual for a match that is not one token span, the class a quoted value was already in. So does a quoted value whose closing quote lies more than `ENTRY_REDACT_MARGIN` past the window's end: it reads unquoted in the margin text. More, all of the token masking: a token that both the widened reading and the pre-round reading print elsewhere, with the same characters, still prints (`relayUnion`'s same-characters residual), and seen at the value level, a value of several tokens prints whole when each of its tokens also prints elsewhere in the same shown window (per-token membership cannot see it; it prints only what rev 3.6 and the whole-text door also print; text only, no pin); the whitespace and the six break characters between a value's tokens print, never its words; a window longer than `DISPLAY_WINDOW_MAX` reads no margin, so it is the size-inexact window as before; and where the widened reading decodes or joins escape sequences, the tokens holding them are masked (availability only).
- **A quoted value never crosses a line**, so a quote closed on a later line is read unquoted, up to its first whitespace.
- **Widening lost to composition.** The widened rules read only what the base door left. Where the base door's mark already took in a NAME (a header value glued to it, `Bearer V&PASSWORD: "W two"`, or a tail head the base read as part of a value, `secret=zqvAPI_KEY= 'zqa zqtail7'`), the `v2` reading finds no head there, and the value after it is read as the base read it. The base prints that value too, so this is no regression. Measured over 60,000 escape-dense fuzzed texts (137,804 planted values, three seeds): the widened rules read over the raw text would mask 807 values through `redactField` that the composed door prints, 865 through `redactFinalLines` and `redactFinalJson`, and 1,986 through the index and display doors. Every value the scope recorded (`password=abc&def`, `password="abc&def"`, `export PASSWORD="s3cr;et"`, `PASSWORD='a b c'`) is still masked whole, and every structural control prints as before ((j5), (j6)).
- **A JSON key's next pair, read as one text** (`{"token":` with `"password": "V"}` on the next line). The JSON-form rule reads `"password"` as token's value and resumes past it, so V prints through `redactField`, `redactFinalLines` and the index and display doors. The base prints V there too: a pre-existing residual of those doors, not a regression. Each line read alone masks V, and Task 3's relay keeps that reading (R4, D-5747).
- **A value a colour sequence split can print whole** (the plan's sixth review). D-4307's joined reading returns a text with every escape sequence removed when that reading finds something to mask. So where the `v2` reading's widened rules find a value only in that reading (`pass\x1b[0mword=&x`, whose `&x` the base does not read), the door returns the whole text without its sequences, a value elsewhere in it that the base printed split by a sequence (`hun\x1b[0mter2xyz`) prints whole, and an index row gains it as one term. The base door does the same where its own rules find one (`tok\x1b[0men=abc` beside it), so the shape is not new: R11 only adds the widened rules' finds to what triggers it. No value the base masked comes back, because the joined reading removes sequences and keeps every mark; (j10) measures that over every reading of the output, and its CONTROL counts 1,941 door readings that print whole a value the base printed split.
- **A value the base printed only JSON-escaped can print decoded** (the plan's seventh review, the same mechanism at a decoded level). The index and display readings keep the decoded level at which their rules find a value, and return the whole text at that level. So where the `v2` reading's widened rules find a value only at a decoded level (`password` + `\u003d&x hunter` + `\u0032xyz`, its escapes JSON unicode escapes: the base reads no value after `password=` because `&x` is not one it reads), `redactForIndex`, `redactForDisplay` and `entryIndexText` return `password=[redacted] hunter2xyz`, where the base returned the text as written, and an index row gains `hunter2xyz` as one term where the base stored `hunter` and `u0032xyz`. The base door does the same where its own rules find a value there (`password` + `\u003dabc hunter` + `\u0032xyz` gives `password=[redacted] hunter2xyz` at the base too), so the shape is not new, and `hunter2xyz` is not a value the base masks: a decoding of the base's output holds it. Measured over 60,000 texts (four seeds, the reviewer's corpus with JSON-escaped NAMEs, separators and values): 21 to 33 such values per 15,000 texts through `redactForIndex`, `redactForDisplay` and `entryIndexText`, 8 to 14 through `sidecarIndexText`, 2 to 8 through the window and the snippet, none through the field, final and relay doors. Because the composed text differs from the base's, Task 2's generation rewrites such a row into the decoded form (D-5746). An index and display change, never a leak.

**Order (R8).** This task touches none of 5h-1's regions (`HEALTH_WORDS`, `deriveHealth`, `HEALTH_REMEDIES`, `remedyFor`, the export path, `readStoreExtras`). 5h-1 inserts lines above every lib.mjs anchor here, so every line number below is a hint only: re-anchor by the quoted content on `main` after 5h-1. Step 4's script asserts each anchor occurs once.

**Files:**
- Modify: `ccd/history/lib.mjs`. Line numbers were measured at `bd363a76b`; re-anchor by the quoted content (Step 4's script does, asserting each anchor once):
  - two new consts, directly above the doc comment that begins `/** Layer 2's rules (the context layer), one definition each, built twice:` (`:1924`);
  - `contextRules`: its doc comment's last line (`:1933`), its signature (`:1934`), the `final` flag in its frozen object and the `namedValue:` line (`:1945`);
  - `BASE_RULES`, directly after `const CONTEXT_RULES = Object.freeze({ field: contextRules(false), final: contextRules(true) });` (`:1953`);
  - in `tailHead`, the line `    return [at + v[1].length, at + v[0].length];` (`:1974`); in `namedSpans`, the line `    head.lastIndex = addChain(s, R, sepEnd + v[1].length, sepEnd + v[0].length, 'named', add);` (`:2025`);
  - `redactRun`'s and `redactLayered`'s signatures (`:2151`, `:2486`: no default form) and, in `redactLayers`, the line that picks `R` (`:2185`) and the final form's test (`:2195`);
  - the doors (`:2470-2720`, `:6443`, `:6618-6623`, `:7156-7345`): `redactField`, `redactForIndex`, `sidecarIndexText`, `entryIndexText`, `redactFinal`, `redactFinalJson`, `redactFinalLines`, `redactFinalText`, `redactIndexReading`, `redactForDisplay`, `displayReading`, `readingAt`, `inexactWindow`, `displayWindow`, `redactDisplayWindow` and `displaySnippet`; and, after `redactFinalText`, the new `DOOR_READINGS`, `composeDoor`, `redactDoorReadings` and `DOOR_OF`;
  - `TOKEN_BREAK_RE`'s doc comment (`:7100-7101`), comment only. The regex is unchanged.
- Modify: `ccd/history/lib.d.mts`: one declaration directly after `export function redactFinalLines(text: string, idx: PairIndex): string;` (`:311`).
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`: §8.3 layer 2's first bullet, `   - the value after \`NAME=\`, \`NAME: \` or \`"name": "\` when NAME matches \`:23\`;` (`:1607`).
- Test: `server/test/history-lib.test.ts`, inside `describe('redaction: values, context and shapes (spec 8.3)', …)` (`:1567`) unless named:
  - (f)'s CONTROL (`:2318`), which now reads one field pass (the base reading): the field door's `v2` reading over the base output masks that value too;
  - (j3)'s leading comment (`:2462-2465`), its ends-at CONTROL (`:2470`) and its residual lines (`:2482-2483`);
  - (j4)'s CONTROL (`:2494`), which now reads one field pass, and one input more that holds the final pass after both field passes (measured: (j4)'s PEM tail is masked by the second field pass, so a `redactFinalLines` without its final pass would have been green on (j4));
  - in `describe('redactForIndex: every JSON-escape reading …')`, the deep-chain case's two counts (`:3336`, `:3343`), and in `describe('entryIndexText: …')`, the window case's bound (`:3488`) and the one-cut-rule case's two source pins (`:3504`, `:3508-3509`): a composed door redacts twice, and each door's body moved into its `…With` function;
  - the case `FU1S: the lead reading's candidates skip the context layer, …` (`:2111`): its case timeout, 60 s, becomes 120 s. Its ratio is unchanged (both sides are composed doors), but each side reads twice: measured alone 4.6 s against 2.0 s at the base, and 63 s, past the old timeout, in a whole-file run at a load average of about 50;
  - six new `it`s, (j5)–(j10), directly above the comment line that begins `  // D-4614 (whole-branch fix round 7): layers 2 and 3 are ORDER-FREE.` (`:2497`), which follows (j4);
  - (l) (`:2571`, D-4614's seeded union fuzz) is NOT edited, and stays green (measured).
  The describe's `idxOf` and `M` (`:1571-1572`), the namespace imports `libRedact` (`:35`) and `libRows` (`:33`), and `f2Cases` (`:15`) cover every name used. No import is added.
- Test: `server/test/fixtures/history/f2Cases.ts` (`:8`, `:15`, `:19`, `:34`): the named form's `endsAt` loses `&` `"` `;` `,`, and a new `admits` list adds whole-mask cases for `;` `,` `'`. The table goes from 21 whole and 13 ends-at cases to 26 and 9 (measured). Its other two consumers, `history-cli.test.ts` H-32 (`:343`) and `history-maint.test.ts`'s relay F2 case (`:511`), compute their expected output with `redactField` and need no edit (measured green).
- Not edited:
  - `ccd/history/sweep.mjs`, `derive.mjs`, `regex-worker.mjs`, `recall.mjs` and `cli.mjs`: they call the exported doors, which are composed, and heal on deploy; stored text is Task 2's;
  - `single-definition.test.ts`: the new names are module-private, or a function declared once in `lib.d.mts`;
  - `BELT_VERSION` and its frozen-contract pin (`history-lib.test.ts:6439`, `expect(libRedact.BELT_VERSION).toBe(1)`): the bump to 2 is Task 2's, in the commit that bumps it.

**Interfaces:**
- Consumes (base, `lib.mjs`, all module-private except the exported doors and `REDACTED_MARK`):
  - `contextRules(final)` and `CONTEXT_RULES`, and `redactLayers(segment, idx, context)`, which unions every rule's spans (D-4614, round 7);
  - `namedSpans(s, R, add)`, `tailHead(s, R, valueStart, end, kind)` and `addChain`;
  - every door's body, as listed under Files, and `beltHit(idx)`, `cutIndexText`, `unescapeJsonText`, `SIDECAR_FTS_BYTES`, `SIDECAR_REDACT_MARGIN`;
  - `IDENTIFIER_RE`, `REDACTED_MARK`, `DISPLAY_INEXACT_NOTE`, `INDEX_UNESCAPE_PASSES`.
- Consumes (tests): every exported door, `makePairIndex`, `secretPairs` and `f2Cases()`.
- Produces:
  - `lib.mjs`, module-private: `QUOTED_LINE_ENDS` (CR, LF, U+2028, U+2029, the last two built with `String.fromCharCode`, so the source holds no raw separator), and `NAMED_VALUE_FIELD_SRC`, the field form's value pattern: group 1 is the opening quote or empty and group 2 is the value; the match consumes a closing quote.
  - `contextRules(final, base = false)`: its frozen object gains `final` (a boolean, which `redactLayers` reads for the final form's second reading). `contextRules(false).namedValue` is `new RegExp(NAMED_VALUE_FIELD_SRC, 'y')`; `contextRules(true)` and `contextRules(false, true)` build v1's class from the base's own template, `(["']?)([^\s"'`,;&\\<>]+)` and `(["']?)([^\s"'`,;&]+)` (measured identical to the base's final and field sources).
  - `BASE_RULES = Object.freeze({ field: contextRules(false, true), final: contextRules(true, true) })`, module-private, read by every door's base reading and nothing else.
  - `redactLayers`, `redactRun`, `redactLayered` and `redactFieldIn` take one form of one rule set (`rs.field` or `rs.final`) as `context`, or `false` for no layer 2; the defaults are gone, so no internal call can fall back to a rule set silently.
  - `DOOR_READINGS` (module-private, frozen): for each door, `base(...args)`, the door with `BASE_RULES`, and `v2(out, idx)`, the same door with `CONTEXT_RULES` over `out`. `composeDoor(r, args, idx)` answers `r.v2(r.base(...args), idx)`. Task 2 adds its owed hit there.
  - `export function redactDoorReadings(door): { base, v2 } | null`, a read-only test accessor that arms nothing (no env var, flag or file, so the Seams constraint holds): history-lib's property, subtractiveness and mutant cases read a door's base reading through it. No shipped file calls it (Step 4 checks). Declared once in `lib.d.mts`.
  - Every exported door keeps its signature and declaration.

**Spec:** §8.3's layer 2, "Context" (`:1607`), amended in Step 7, citing D-5745 and R11. The departure is D-5745 (`history-redact-value-class-widened`); its entry is in this plan's "Deviations found". Rulings: R1 (the exact widening, the single quote as a quote), R2 (Bearer and box-token unchanged), R3 (the reindex is Task 2's sweep phase), and R11, the coordinator's composition ruling of 2026-10-19, which amends R1 and R3. The task closes D-5021's residual, keeps D-4613, and leaves D-4614's union and tail-head reading unchanged apart from span arithmetic.

**Choices this task makes:**
- **The closing quote is consumed by a backreference (`\1`), not checked by a lookahead.** That makes the value group's own span load-bearing: a span from the whole match would mask the closing quote, and mutant M3 measures exactly that. It also needs only one value group across the three alternatives. A lookbehind on each quoted alternative, `(?<=")` or `(?<=')`, reads which quote group 1 took.
- **An unclosed quote reads unquoted.** The quoted reading fails, group 1 backs off to empty, and the quote is the value's first character. Over the base output that is the base's mark too: `password="abc def` → base `password="[redacted] def` → `password=[redacted] def`, and `PASSWORD=")Kq9xYz end` → `PASSWORD=[redacted] end` (the third review's shape, masked by construction).
- **An empty quoted value is matched, not refused.** Its group 2 is `''`, and `add` already drops an empty span, so no caller needs a new branch. Refusing it would let the unquoted reading take `"` as a value (the scope's first cut printed `TOKEN=[redacted]"`; mutant M6).
- **The composition is per door, over the door's whole output.** A repair inside a door (v1's spans unioned into the widened reading's, an opening quote admitted before a closer, a stop in the widened pattern) is what the two rounds' three patches tried: the second reading of a door that reads twice (`redactFinalLines`' final pass, the index readings of the decoded text) could still find its context taken by the widened value of the first. Over the whole door's output nothing the base door masked is left to take. It costs about two passes of each door: measured over a corpus of 29,495 4-KiB rows of this repository's code and docs (112 MiB), `entryIndexText` took 17.8 to 19.4 s composed against 9.2 to 9.7 s at `bd363a76b` (three runs each, one box under a load average of about 13), 1.9 to 2.0 times. Capture's index step and every read door pay it.
- **The base reading is the rev 3.6 door, byte for byte.** `BASE_RULES` is built from `contextRules`' own template, and every door's body is the base's body with the rule set handed in. Measured over 60,000 fuzzed texts (three seeds), every door's base reading equalled `bd363a76b`'s own door on every text (660,000 door readings), and (j7) pins the field door's base reading equal to v1's literal output on its table (mutant M9).
- **Subtractive, measured.** Over 3,000 fuzzed texts through every door, every `v2` reading's output was a run of pieces of its input, or of a JSON-escape decoding of it, in order, between marks (0 failures, two runs); so was every base reading except one and two `redactDisplayWindow` readings in those runs, which read a slice of the text (an inexact window decodes the slice alone, so a piece can end in a backslash whose escape lies outside it): over that slice they hold. (j9) pins the `v2` readings over every door. With escape sequences, a reading's output is pieces of its input read past any sequence: the joined reading removes those the raw reading left whole, and the raw reading's mark can take part of one (at the base, `password=hunter2\x1b[1;31mq72z` reads `password=[redacted];31mq72z`). So (j9) matches each piece past any sequence it skips, over 300 texts with colour sequences inside NAMEs and values besides f2Cases and the 600: 0 failures for both readings. A checker that removed every sequence or none failed 138 of those (the plan's sixth review).
- **No value the base masks prints, measured and pinned.** Over 60,000 escape-dense fuzzed texts (three seeds, 137,804 planted values), through all eleven doors: 0 values that the door at `bd363a76b` masks printed. The widened rules read over the raw text (mutant M8) printed 7,284 of them through `redactField`, 4,327 through `redactFinalLines`, 10,470 through the index and display doors, 19,253 through `redactDisplayWindow` and 15,853 through `displaySnippet`. (j10) pins it over f2Cases, the reviews' shapes and two seeded corpora, a value counting as masked only when no reading of the output holds it (as written, decoded, or past any sequence inside it): 44,422 values the base doors mask, 0 printed, 3,530 printed by the widened rules over the raw text (31,380 and 2,808 of them in the corpus with no sequences; 13,042 and 722 in the 1,000 texts with colour sequences). Its CONTROL counts the joined reading's residual (above): 1,941.
- **The final pass stays load-bearing.** Under composition `redactField` is two field passes, and the second takes (j4)'s PEM tail too, so (j4)'s first input no longer separates `redactFinalLines` from a `redactFinalLines` without its final pass. A seeded search of 80,000 texts found 11 that do; (j4) gains the simplest, `"api_key":"hunter2xyz:token=abc&def\"` (the field passes leave the JSON value, whose closing quote the second field pass exposes; the final pass masks it). Mutant M10 is red on it.
- **(j8)'s linearity input that reaches the widened pattern.** Under composition the widened pattern reads only what the base door leaves, so most of (j8)'s 1 MiB inputs reach it already masked. An open quote over `x&` repeated does not: the base masks the first `x` and leaves the rest whole. The overlapping-alternation mutant (M5) doubles its cost per added unit there (24, 45, 89 and 199 ms at 11 to 14 units, measured outside vitest) and is killed by the shell's `timeout` in (j8); the shipped pattern took 0 to 4 ms.
- **The (j3) ends-at CONTROL drops from `>= 10` to `>= 9`.** The named form's `&` `"` `;` `,` moved from ends-at to whole, which leaves 9 ends-at cases (Bearer 3, named 3, box-token 3, measured). The whole-case CONTROL (`>= 15`) now counts 26.
- **The cost pins.** Two existing cases count value-layer asks rather than time. The deep-chain case's field door now asks twice per body run (one redaction per reading), and its bound gains the `v2` reading's one redaction (the bound leaves no backslash for it to decode further): `(8 + 1 + 1) * RUNS`. The window case's bound gains the `v2` reading of the base output, which the cut holds to `ENTRY_FTS_BYTES`: `Math.ceil(W / 3) + Math.ceil(N / 3)` (measured exactly that, 720,896).

- [ ] **Step 0: Check that the base holds wave 5h-1's merge (R8).** Before any edit, from the repository root, with the 5h-1 merge commit the brief names in place of `<5h-1-merge>`:

```bash
git merge-base --is-ancestor <5h-1-merge> HEAD && echo 'base holds 5h-1' || echo 'STOP: 5h-1 is not on this base'
```

Expected: `base holds 5h-1`. On `STOP`, make no edit: report to the coordinator and wait. Every later task's anchors assume 5h-1's code and spec.

- [ ] **Step 1: Confirm the anchors and that no name is taken.** From the repository root, on the base after 5h-1:

```bash
grep -cF -f - ccd/history/lib.mjs <<'EOF'
    namedValue: new RegExp(String.raw`(["']?)([^\s"'` + '`' + String.raw`,;&${final ? String.raw`\\<>` : ''}]+)`, 'y'),
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
    head.lastIndex = addChain(s, R, sepEnd + v[1].length, sepEnd + v[0].length, 'named', add);
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
    return [at + v[1].length, at + v[0].length];
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
  const R = context ? (context === 'final' ? CONTEXT_RULES.final : CONTEXT_RULES.field) : null;
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
function contextRules(final) {
EOF
grep -cE '^export function (redactField|redactForIndex|sidecarIndexText|entryIndexText|redactFinal|redactFinalJson|redactFinalLines|redactFinalText|redactForDisplay|redactDisplayWindow|displaySnippet)\(' ccd/history/lib.mjs
grep -cE '^function (redactIndexReading|displayReading|readingAt|inexactWindow|displayWindow)\(' ccd/history/lib.mjs
grep -cF -f - server/test/fixtures/history/f2Cases.ts <<'EOF'
  { form: 'named', make: (v) => `password=${v}`, endsAt: ['&', '"', ';', ',', '`', '\r', 
EOF
grep -cF -f - server/test/history-lib.test.ts <<'EOF'
  // D-4614 (whole-branch fix round 7): layers 2 and 3 are ORDER-FREE. Every context rule and every shape matches the same text,
EOF
grep -c 'NAMED_VALUE_FIELD_SRC\|QUOTED_LINE_ENDS\|BASE_RULES\|DOOR_READINGS\|composeDoor\|redactDoorReadings\|DOOR_OF' ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts
grep -c "^- \*\*D-5745\*\* — \`history-redact-value-class-widened\`" docs/superpowers/plans/2026-10-19-ccrc-history-w5h2-redaction-and-ops.md
```

Expected (measured at `bd363a76b`, except the last line):
- the first five anchor counts are 1 each; then `11` (the eleven exported doors) and `5` (the five module-private readings); then 1 for the f2Cases line and 1 for the history-lib comment. The f2Cases pattern ends at `'\r', ` (a trailing space), because the line's last element is a raw U+2028 character that this plan never quotes;
- the name count is 0 in each of the three files;
- the last command prints 1, from this plan's own "Deviations found".

Step 4's script asserts every other anchor once as it edits. A different count means the base moved: re-read the region before editing.

- [ ] **Step 2: Write the failing tests.** Three edits.

(a) `server/test/fixtures/history/f2Cases.ts`. Make four replacements, each matching once.

Replace
```ts
 *  (B1's shared rule, unchanged from the base: `password=abc&def` prints `password=[redacted]&def`), and the pin is then that
```
with
```ts
 *  (`Authorization: Bearer abc"def` prints `Authorization: Bearer [redacted]"def`, kept by ruling R2; D-5745 widened only the
 *  named form, so `password=abc&def` now prints `password=[redacted]`), and the pin is then that
```

Replace
```ts
const F2_FORMS: Array<{ form: string; make: (v: string) => string; endsAt: string[] }> = [
```
with
```ts
// `admits` (D-5745): characters outside the five that the form's class admits, each a whole-mask case of its own.
const F2_FORMS: Array<{ form: string; make: (v: string) => string; endsAt: string[]; admits?: string[] }> = [
```

In the named form's line, replace only its prefix (the line's tail, `'<U+2028>'] },`, stays as it is)
```ts
  { form: 'named', make: (v) => `password=${v}`, endsAt: ['&', '"', ';', ',', '`', '\r', 
```
with
```ts
  { form: 'named', make: (v) => `password=${v}`, admits: [';', ',', "'"], endsAt: ['`', '\r', 
```
Both strings end in one space, after `'\r',`.

Replace
```ts
    // the characters a class ends at that the five do not name (`;` `,` a backtick, CR, U+2028)
```
with
```ts
    // D-5745: the characters a class admits that the five do not name (the named form's `;` `,` and `'`), masked whole
    for (const c of f.admits ?? []) {
      out.push({ form: f.form, char: c, input: f.make(`ab${c}cdXQ9`), whole: true, viaStream: true, runs: ['cdXQ9'] });
    }
    // the characters a class ends at that the five do not name (a backtick, CR, U+2028; D-5745 moved the named form's `;` and `,`
    // to `admits`)
```

(b) `server/test/history-lib.test.ts`, the existing cases: eleven replacements, each asserted to match once. From the repository root:

```bash
python3 - <<'EOF'
def patch(p, pairs):
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:90], s.count(old))
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)

patch('server/test/history-lib.test.ts', [
    # (j3)
    ("  // character masks the value whole; a class that ENDS at it (B1's shared rule, unchanged from the base, and widening it is a\n"
     "  // reindex that B3 evaluates) leaves the field pass's own output, so redactFinalLines must equal redactField there: the field pass\n",
     "  // character masks the value whole; a class that ENDS at it (the Bearer and box-token header classes at `\"`, kept by ruling R2;\n"
     "  // D-5745 widened the named form's) leaves the field pass's own output, so redactFinalLines must equal redactField there: the field pass\n"),
    ("    expect(cases.filter((c) => !c.whole).length, 'CONTROL: and ends-at cases').toBeGreaterThanOrEqual(10);\n",
     "    expect(cases.filter((c) => !c.whole).length, 'CONTROL: and ends-at cases (D-5745 moved the named form\\'s & \" ; , \\' to whole)').toBeGreaterThanOrEqual(9);\n"),
    ("    // the residual, as measured: the two examples D-5021 records\n"
     "    expect(libRedact.redactFinalLines('password=abc&def', idx)).toBe(`password=${M}&def`);\n",
     "    // D-5021's two recorded examples: D-5745 closes the named one (the field form reads the value whole), and the Bearer one stays by\n"
     "    // ruling R2 (an RFC 6750 b64token never holds a quote, and a closing `\"` after a header value is the common real case)\n"
     "    expect(libRedact.redactFinalLines('password=abc&def', idx)).toBe(`password=${M}`);\n"),
    # (j4): the CONTROL reads one field pass, and a second input holds the final pass under R11
    ("    expect(libRedact.redactField(text, idx), 'CONTROL: the field pass alone leaves the tail').toBe(`x-ccrc-mail-token: ${M}TAILSECRET99`);\n"
     "    expect(libRedact.redactFinalLines(text, idx), 'the final pass takes it').toBe(`x-ccrc-mail-token: ${M}`);\n",
     "    // R11: the field door is now two field passes (its v2 reading over its base reading), and the second takes this tail too, so the\n"
     "    // CONTROL reads one pass, the base reading; the second input holds the final pass after both field passes\n"
     "    const field = libRedact.redactDoorReadings(libRedact.redactField)!;\n"
     "    expect(field.base(text, idx), 'CONTROL: one field pass leaves the tail').toBe(`x-ccrc-mail-token: ${M}TAILSECRET99`);\n"
     "    expect(libRedact.redactFinalLines(text, idx), 'the final pass takes it').toBe(`x-ccrc-mail-token: ${M}`);\n"
     "    const quoted = '\"api_key\":\"hunter2xyz:token=abc&def\\\\\"';\n"
     "    expect(libRedact.redactField(quoted, idx), 'CONTROL: both field passes leave the JSON value').toBe(`\"api_key\":\"hunter2xyz:token=${M}\"`);\n"
     "    expect(libRedact.redactFinalLines(quoted, idx), 'the final pass takes it').toBe(`\"api_key\":\"${M}\"`);\n"),
    # (f): the CONTROL reads one field pass
    ("    expect(libRedact.redactField(shaped, idx), 'CONTROL: the field form alone leaves the value').toContain('hunter2hunter2');\n",
     "    // R11: the field door's v2 reading reads the base reading's output and takes it too, so the CONTROL reads one pass\n"
     "    expect(libRedact.redactDoorReadings(libRedact.redactField)!.base(shaped, idx), 'CONTROL: one field pass leaves the value').toContain('hunter2hunter2');\n"),
    # the deep-chain cost pin
    ("    const one = countingIdx();\n"
     "    libRows.redactField(s, one.idx);\n"
     "    expect(one.asks(), 'CONTROL: one redaction asks once per body run').toBe(RUNS);\n",
     "    const one = countingIdx();\n"
     "    libRows.redactField(s, one.idx);\n"
     "    // R11: the field door is two readings, each one redaction\n"
     "    expect(one.asks(), 'CONTROL: one redaction asks once per body run').toBe(2 * RUNS);\n"),
    ("    expect(many.asks()).toBeLessThanOrEqual((8 + 1) * RUNS);\n",
     "    // R11: the base reading's 8 + 1, and one redaction more for the v2 reading, over a text the bound left with no backslash\n"
     "    expect(many.asks()).toBeLessThanOrEqual((8 + 1 + 1) * RUNS);\n"),
    # the entry window's cost pin
    ("    expect(asks).toBeLessThanOrEqual(Math.ceil(W / 3));\n",
     "    // R11: the base reading reads the window, and the v2 reading reads its output, which the cut holds to N bytes\n"
     "    expect(asks).toBeLessThanOrEqual(Math.ceil(W / 3) + Math.ceil(N / 3));\n"),
    # the one-cut-rule source pin
    ("      const at = src.indexOf(`export function ${fn}(`);\n",
     "      const at = src.indexOf(`function ${fn}(`);   // R11: each door's body over one rule set\n"),
    ("    expect(body('sidecarIndexText')).toMatch(/return cutIndexText\\(text, w\\.windowCut, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN\\);/);\n"
     "    expect(body('entryIndexText')).toMatch(/return cutIndexText\\(redactForIndex\\(w\\.text, idx\\), w\\.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN\\);/);\n",
     "    expect(body('sidecarIndexTextWith')).toMatch(/return cutIndexText\\(text, w\\.windowCut, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN\\);/);\n"
     "    expect(body('entryIndexTextWith')).toMatch(/return cutIndexText\\(redactForIndexWith\\(w\\.text, idx, rs\\), w\\.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN\\);/);\n"),
    # the FU1S lead-reading case's ceiling: both sides of its ratio are composed doors now, about twice as long
    ("    expect(tLead).toBeLessThan(12 * tOne);\n  }, 60_000);\n",
     "    expect(tLead).toBeLessThan(12 * tOne);\n  }, 120_000);   // R11: a ceiling, not the detector (the ratio decides); each composed door reads twice\n"),
])
print('Task 1: history-lib.test.ts, eleven replacements')
EOF
```

The (j3) Bearer line after its replaced pair, `expect(libRedact.redactFinalLines('Authorization: Bearer abc"def', idx)).toBe(\`Authorization: Bearer ${M}"def\`);`, stays as it is: that is R2's pin.

(c) `server/test/history-lib.test.ts`. Directly above the line that begins `  // D-4614 (whole-branch fix round 7): layers 2 and 3 are ORDER-FREE.`, insert:

```ts
  // D-5745 (history-redact-value-class-widened; closes D-5021's residual; ruling R1): the FIELD form's named value is read whole. A
  // quoted value runs to its closing quote on the same line. An unquoted value still ends at whitespace and the backtick; it ends at
  // `&` only before NAME=, and at `,` `;` `"` `'` only before whitespace, a closer or the end of the text. The final form is unchanged
  // (D-4613's structure safety). Every door reads the widened rules only over its rev 3.6 door's output (R11), so no door masks less
  // than at the base. A key-shaped literal is never written: these values are plain words.
  it('(j5) the field form reads a named value whole: & ; , and either quote inside it, and a quoted value to its closing quote (D-5745)', () => {
    const idx = idxOf([]);
    // [input, the field door's output, the final form's output alone: v1's reading, unchanged]
    const cases: Array<[string, string, string]> = [
      ['password=abc&def', `password=${M}`, `password=${M}&def`],
      ['password=abc;def', `password=${M}`, `password=${M};def`],
      ['password=abc,def', `password=${M}`, `password=${M},def`],
      ["password=abc'def", `password=${M}`, `password=${M}'def`],
      ['password=abc"def', `password=${M}`, `password=${M}"def`],
      ['password="abc&def"', `password="${M}"`, `password="${M}&def"`],
      ['export PASSWORD="s3cr;et"', `export PASSWORD="${M}"`, `export PASSWORD="${M};et"`],
      ["PASSWORD='a b c'", `PASSWORD='${M}'`, `PASSWORD='${M} b c'`],
      ['secret: "two words" next', `secret: "${M}" next`, `secret: "${M} words" next`],
      // an unclosed quote: the rev 3.6 door masks the value after it, and the widened rules read the quote and that mark as one value
      ['password="abc def', `password=${M} def`, `password="${M} def`],
      // the plan's third review found the widened reading ALONE less masked than the base on these: a quoted value that takes a
      // secret NAME and `: ` or a tab in, and an unclosed quote a closer follows. Read over the rev 3.6 door's output (R11), each is
      // masked at least as the base masks it
      ['PASSWORD="token: "hunter2xyz', `PASSWORD="${M}"${M}`, `PASSWORD="${M} "${M}`],
      ["SECRET='password: 'hunter2xyz", `SECRET='${M}'${M}`, `SECRET='${M} '${M}`],
      ['PASSWORD="token:\thunter2 "zz', `PASSWORD="${M}"zz`, `PASSWORD="${M}\t${M} "zz`],
      ['PASSWORD=")Kq9xYz end', `PASSWORD=${M} end`, `PASSWORD="${M} end`],
      ["token: ']Wq8 next", `token: ${M} next`, `token: '${M} next`],
      ['password="}abc', `password=${M}`, `password="${M}`],
    ];
    for (const [input, want, finalAlone] of cases) {
      expect(libRedact.redactField(input, idx), input).toBe(want);
      expect(libRedact.redactFinalLines(input, idx), `redactFinalLines: ${input}`).toBe(want);
      expect(libRedact.redactFinalJson({ a: input }, idx), `redactFinalJson: ${input}`).toEqual({ a: want });
      expect(libRedact.redactFinal(input, idx), `CONTROL: the final form is unchanged (D-4613): ${input}`).toBe(finalAlone);
      expect(libRedact.redactForIndex(input, idx), `redactForIndex: ${input}`).toBe(want);
      expect(libRedact.redactForDisplay(input, idx), `redactForDisplay: ${input}`).toBe(want);
      expect(libRedact.redactField(want, idx), `idempotent: ${want}`).toBe(want);
    }
    // an ESCAPED quote takes no quoted arm: the rev 3.6 door masks the backslash alone, and the widened rules read that mark and the
    // `"a` after it as one value. Raw, and JSON-serialised. [input, the field door's output, the final form alone, the index door's]
    const escaped: Array<[string, string, string, string]> = [
      ['password=\\"a b\\"', `password=${M} b\\"`, 'password=\\"a b\\"', `password=${M} b\\"`],
      [JSON.stringify('password="a b"'), `"password=${M} b\\""`, JSON.stringify('password="a b"'), `"password=${M} b\\""`],
    ];
    for (const [input, want, finalAlone, indexed] of escaped) {
      expect(libRedact.redactField(input, idx), input).toBe(want);
      expect(libRedact.redactFinalLines(input, idx), `redactFinalLines: ${input}`).toBe(want);
      expect(libRedact.redactFinalJson({ a: input }, idx), `redactFinalJson: ${input}`).toEqual({ a: want });
      expect(libRedact.redactFinal(input, idx), `CONTROL: the final form is unchanged (D-4613): ${input}`).toBe(finalAlone);
      expect(libRedact.redactForIndex(input, idx), `redactForIndex: ${input}`).toBe(indexed);
      expect(libRedact.redactForDisplay(input, idx), `redactForDisplay: ${input}`).toBe(indexed);
    }
    // the plan's fifth review: a NAME=value glued to an escaped JSON pair. Read alone, the widened rules took the escaped key into the
    // NAME's value, and the index and display readings, decoding the escapes, then printed hunter2xyz on every glue. The rev 3.6 door
    // masks it, and the widened rules read only that door's output (R11)
    const escapedPair = String.raw`{"text":"TOKEN=abc,\"api_key\": \"hunter2xyz\"}"}`;
    for (const door of [libRedact.redactForIndex, libRedact.redactForDisplay, libRedact.entryIndexText]) {
      expect(door(escapedPair, idx), `${door.name}: ${escapedPair}`).toBe(`{"text":"TOKEN=${M} "${M}"}"}`);
      expect(door(String.raw`TOKEN=abc\"api_key\": \"hunter2xyz\"`, idx), `${door.name}: bare`).toBe(`TOKEN=${M} "${M}"`);
      for (const name of ['TOKEN', 'password', 'api_key', 'SECRET_KEY']) {
        for (const key of ['api_key', 'token', 'password', 'secret']) {
          for (const glue of ['', ',', ';', '&', ')', '}', ']', '|', '/', ':', '(', '{', '[', "'"]) {
            const bare = `${name}=abc${glue}\\"${key}\\": \\"hunter2xyz\\"`;
            for (const text of [bare, `{"text":"${bare}"}`]) expect(door(text, idx), `${door.name}: ${text}`).not.toContain('hunter2xyz');
          }
        }
      }
    }
    // a tail head after a quoted value reads its own quoted value; each span is its value group's own, so both closing quotes stay.
    // A widened value that ends in a head hands it its quoted value too, which the base reads as no value
    expect(libRedact.redactField('password="xAPI_KEY="hunter2two"', idx)).toBe(`password="${M}"${M}"`);
    expect(libRedact.redactField("password=a,API_KEY=' hunter2 two' end", idx)).toBe(`password=${M}'${M}' end`);
    // whitespace and the backtick still end an unquoted value, and a quoted value never crosses a line
    expect(libRedact.redactField('password=abc def', idx)).toBe(`password=${M} def`);
    expect(libRedact.redactField('password=abc`def', idx)).toBe(`password=${M}\`def`);
    expect(libRedact.redactField('password="abc\ndef"', idx)).toBe(`password=${M}\ndef"`);
  });
  it('(j6) the widened value keeps structure: & before NAME=, and , ; " \' before whitespace, a closer or the end, still end it (D-5745)', () => {
    const idx = idxOf([]);
    const cases: Array<[string, string]> = [
      ['url?a=1&password=x&b=2', `url?a=1&password=${M}&b=2`],
      ['password=abc; path=/', `password=${M}; path=/`],
      ['password=abc, user=bob', `password=${M}, user=bob`],
      ['token=x&next=1', `token=${M}&next=1`],
      ['{"cmd":"password=abc"}', `{"cmd":"password=${M}"}`],
      ["run('password=abc')", `run('password=${M}')`],
      ['f(password=abc;)', `f(password=${M};)`],
      ['password=abc;', `password=${M};`],
    ];
    for (const [input, want] of cases) {
      expect(libRedact.redactField(input, idx), input).toBe(want);
      expect(libRedact.redactFinalLines(input, idx), `redactFinalLines: ${input}`).toBe(want);
    }
    // CONTROLs: an empty quoted value is no value, a line with no secret name is unchanged, and marks are a fixed point
    for (const x of ['TOKEN=""', "TOKEN='' next", 'level=INFO path=/a/b', 'a=b&c=d <x> "q"', `password="${M}"`, `password=${M}`]) {
      expect(libRedact.redactField(x, idx), x).toBe(x);
      expect(libRedact.redactFinalLines(x, idx), x).toBe(x);
    }
  });
  it('(j7) a stored v1 output heals: the field door over what v1 printed equals the field door over the raw text (D-5745)', () => {
    const idx = idxOf([]);
    const base = libRedact.redactDoorReadings(libRedact.redactField)!;
    // [raw text, what v1's field pass printed for it, measured at the base]
    const table: Array<[string, string]> = [
      ['password=abc&def', `password=${M}&def`],
      ['password=abc;def', `password=${M};def`],
      ['password=abc,def', `password=${M},def`],
      ["password=abc'def", `password=${M}'def`],
      ['password=abc"def', `password=${M}"def`],
      ['password="abc&def"', `password="${M}&def"`],
      ['export PASSWORD="s3cr;et"', `export PASSWORD="${M};et"`],
      ["PASSWORD='a b c'", `PASSWORD='${M} b c'`],
      ['password="abc', `password="${M}`],
      ['TOKEN="a b" next', `TOKEN="${M} b" next`],
      ['api_key=x;y,z&w', `api_key=${M};y,z&w`],
      ['secret: "two words"', `secret: "${M} words"`],
      ['token=ab"cd"ef', `token=${M}"cd"ef`],
      ['password=abc;def&ghi', `password=${M};def&ghi`],
    ];
    for (const [raw, v1] of table) {
      // R11: the field door's base reading IS v1's field pass, byte for byte (the rev 3.6 rules, kept as BASE_RULES)
      expect(base.base(raw, idx), `the base reading is v1's: ${JSON.stringify(raw)}`).toBe(v1);
      const want = libRedact.redactField(raw, idx);
      expect(want, `CONTROL: the widening changes ${JSON.stringify(raw)}`).not.toBe(v1);
      expect(libRedact.redactField(v1, idx), `${JSON.stringify(v1)} heals`).toBe(want);
    }
  });
  it('(j8) the widened named value stays linear: 1 MiB of & before non-names, quotes before non-closers, open quotes and & before long names (D-5745)', () => {
    const idx = idxOf([]);
    const MIB = 1 << 20;
    const fill = (unit: string): string => unit.repeat(Math.ceil(MIB / unit.length)).slice(0, MIB);
    const inputs: Array<[string, string]> = [
      ['& before a non-name', `password=${fill('&a')}`],
      ['a quote before a non-closer', `password=${fill('"x')}`],
      ['an open quote', `password="${fill('x')}`],
      ['an open single quote over spaces and semicolons', `password='${fill('x; ')}`],
      ['& then a long name with no =', `password=&${fill('a')}`],
      ['& before a 256-character name and =', fill(`password=x&${'a'.repeat(256)}=`)],
      ['heads with quotes of both kinds', fill('password="x password=\'y ')],
      ['heads with an empty quoted value', fill('TOKEN="" ')],
      ['heads ending at a closer', fill('password=a,)')],
      ['quoted values holding a NAME: head', fill('password="token: "')],
      ['a quote and a closer after each head', fill('PASSWORD=")K ')],
      // R11: the widened pattern reads only what the rev 3.6 door leaves, so its long input is an open quote over & before non-names,
      // which the base masks up to the first & and leaves whole after it
      ['an open quote over & before non-names', `password="${fill('x&')}`],
    ];
    for (const [name, text] of inputs) {
      for (const [door, fn] of [['redactField', libRedact.redactField], ['redactFinalLines', libRedact.redactFinalLines]] as const) {
        const t0 = Date.now();
        fn(text, idx);
        // a quadratic reading of any of these is minutes; the bound is a ceiling, not the detector
        expect(Date.now() - t0, `${door} ${name}`).toBeLessThan(30_000);
      }
    }
  }, 300_000);
  // R11 (the coordinator's composition ruling of 2026-10-19, amending R1 and R3): every redaction door of this build is its v2 reading
  // (the door built from the widened rules) over its base reading (the rev 3.6 door, BASE_RULES), and every reading is SUBTRACTIVE: its
  // output is its input, or a JSON-escape decoding of it, or its input with every escape sequence removed (D-4307's joined reading,
  // which a text holding a sequence takes when that reading finds something), with spans replaced by the mark (a window's or a
  // snippet's cut may fall inside a mark, and a window carries its note). It writes no character its input did not hold, but removing
  // a sequence glues the text either side of it, so a value a sequence split can print whole. A value a door MASKS is therefore one
  // that no reading of its output holds (as written, decoded, or with its sequences removed), and the v2 reading never writes back
  // a value the base reading masked.
  const R11_NOTE = libRedact.DISPLAY_INEXACT_NOTE;
  const r11Decode = (t: string): string => t.replace(/\\(?:([nrtbf"\\/])|u([0-9a-fA-F]{4}))/g, (_m, c: string | undefined, u: string) =>
    (c !== undefined ? ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[c]! : String.fromCharCode(parseInt(u, 16))));
  /** A CSI sequence (the shape r11AnsiCorpus plants), or an `ESC` and the one character after it (what a window's or a snippet's
   *  cut leaves of one), never taking a mark's first character (ANSI_ESCAPE_RE's rule). */
  const R11_CSI = /\x1b\[(?!redacted\])[0-?]*[ -/]*[@-~]|\x1b[ -/]*(?!\[redacted\])[0-~]/g;
  /** The text and each JSON-escape decoding of it. */
  const r11Readings = (t: string): string[] => {
    const out = [t];
    for (let level = 0; level <= libRedact.INDEX_UNESCAPE_PASSES; level += 1) {
      const next = r11Decode(out[out.length - 1]!);
      if (next === out[out.length - 1]) break;
      out.push(next);
    }
    return out;
  };
  /** `p` as a pattern that may skip any CSI sequence between two of its characters: a reading can remove any of a text's
   *  sequences (the joined reading removes those its raw reading left whole, and the raw reading's mark can take part of one). */
  const r11Piece = (p: string): RegExp =>
    new RegExp([...p].map((c) => c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')).join(`(?:${R11_CSI.source})*?`), 'g');
  /** The end of the first match of `p` in `reading` from `at`, or -1 (a text with no `ESC` is matched as it is). */
  const r11Find = (reading: string, p: string, at: number): number => {
    if (!reading.includes('\x1b')) { const k = reading.indexOf(p, at); return k === -1 ? -1 : k + p.length; }
    const re = r11Piece(p);
    re.lastIndex = at;
    const m = re.exec(reading);
    return m === null ? -1 : m.index + m[0].length;
  };
  /** Whether some reading of `t` holds `v`, with or without the sequences inside it: a door that prints `v` in none masks it. */
  const r11Holds = (t: string, v: string): boolean => r11Readings(t).some((r) => r11Find(r, v, 0) !== -1);
  /** Whether `out` holds, between its marks, only pieces of one reading of `input` (r11Readings), in order, each read past any
   *  sequence of `input` it skips. */
  const r11Subtractive = (input: string, out: string): boolean => {
    let o = out;
    if (o.startsWith(`${R11_NOTE}\n`) || o.startsWith(`${R11_NOTE} `)) o = o.slice(R11_NOTE.length + 1);
    if (o.startsWith('...')) o = o.slice(3);
    if (o.endsWith('...')) o = o.slice(0, -3);
    const parts = o.split(M);
    for (let j = M.length - 1; j > 0; j -= 1) {
      const last = parts[parts.length - 1]!;
      if (last.endsWith(M.slice(0, j))) { parts[parts.length - 1] = last.slice(0, -j); break; }
    }
    for (let j = M.length - 1; j > 0; j -= 1) if (parts[0]!.startsWith(M.slice(-j))) { parts[0] = parts[0]!.slice(j); break; }
    const pieces = parts.filter((p) => p !== '');
    return r11Readings(input).some((reading) => {
      let at = 0;
      return pieces.every((p) => { at = r11Find(reading, p, at); return at !== -1; });
    });
  };
  /** A seeded generator (mulberry32). */
  const r11Rng = (seed0: number): (() => number) => {
    let seed = seed0;
    return (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  /** Seeded texts of the shapes that separated the widened reading from the base (the plan's third and fifth reviews): secret
   *  `NAME=` and `NAME: ` pairs, quoted, escaped, unclosed and glued values, raw and escaped JSON pairs, a JSON key before the next
   *  pair, anchors, glue and noise, half of them JSON-serialised. `vs` are the values planted in each. */
  const r11Corpus = (seed0: number, n: number): Array<{ t: string; vs: string[] }> => {
    const rnd = r11Rng(seed0);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const NAMES = ['password', 'PASSWORD', 'TOKEN', 'api_key', 'SECRET_KEY', 'token', 'secret', 'API_KEY', 'auth', 'private_key'];
    const KEYS = ['api_key', 'token', 'password', 'secret'];
    const GLUE = ['', ',', ';', '&', ')', '}', ']', '|', '/', ':', '(', '{', '[', "'", '"', ' ', '\\n', '\\"'];
    const FR: Array<(v: string) => string> = [
      (v) => `${pick(NAMES)}=${v}`, (v) => `${pick(NAMES)}: ${v}`, (v) => `${pick(NAMES)}="${v}"`, (v) => `${pick(NAMES)}='${v} more'`,
      (v) => `${pick(NAMES)}=\\"${v}\\"`, (v) => `${pick(NAMES)}=ab${pick(GLUE)}${v}`, (v) => `"${pick(KEYS)}": "${v}"`,
      (v) => `"${pick(KEYS)}":"${v}`, (v) => `\\"${pick(KEYS)}\\": \\"${v}\\"`, (v) => `\\"${pick(KEYS)}\\": \\"${v}`,
      (v) => `${pick(NAMES)}="${pick(KEYS)}: "${v}`, (v) => `${pick(NAMES)}=${pick(['"', "'"])}${pick([')', '}', ']'])}${v} end`,
      (v) => `Authorization: Bearer ${v}`, (v) => `x?token=${v}&b=1`, (v) => `{"${pick(KEYS)}":\n"${pick(KEYS)}": "${v}"}`,
      (v) => `${pick(NAMES)}=abc&${v}`, (v) => `${pick(NAMES)}: "${v} two"`,
      () => 'plain words here', () => '\\n', () => '\\"', () => '"', () => "'", () => ' ', () => '\n', () => 'level=INFO path=/a/b', () => 'url?a=1&b=2',
    ];
    let vn = 0;
    return Array.from({ length: n }, () => {
      const vs: string[] = [];
      let t = '';
      for (let i = 0, k = 1 + Math.floor(rnd() * 6); i < k; i += 1) {
        const v = `hunter2q${(vn++).toString(36)}z`;
        const piece = pick(FR)(v);
        if (piece.includes(v)) vs.push(v);
        t += piece + pick(GLUE);
      }
      return { t: rnd() < 0.5 ? JSON.stringify({ text: t }) : t, vs };
    });
  };
  /** Seeded texts with CSI colour sequences inside a NAME, a key or a value (`grep --color=always` or a highlighter colours a word
   *  in part), which D-4307's joined reading reads whole, and the break-redaction review of round 1's shape: a NAME a sequence
   *  splits, whose widened value `&x` only the joined reading finds, then a value a sequence splits, alone and after the same value
   *  masked. A quarter of them JSON-serialised. `vs` are the values planted, each held by its piece with the sequences removed. */
  const r11AnsiCorpus = (seed0: number, n: number): Array<{ t: string; vs: string[] }> => {
    const rnd = r11Rng(seed0);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const NAMES = ['password', 'PASSWORD', 'TOKEN', 'api_key', 'secret', 'token'];
    const SEQS = ['\x1b[0m', '\x1b[32m', '\x1b[1;31m', '\x1b[m'];
    const cut = (s: string): string => { const k = 1 + Math.floor(rnd() * (s.length - 1)); return `${s.slice(0, k)}${pick(SEQS)}${s.slice(k)}`; };
    const FR: Array<(v: string) => string> = [
      (v) => `${cut(pick(NAMES))}=&x ${cut(v)}`, (v) => `${pick(NAMES)}=${v} then ${cut(pick(NAMES))}=&x ${cut(v)}`,
      (v) => `${cut(pick(NAMES))}=${v}`, (v) => `${pick(NAMES)}=${cut(v)}`, (v) => `${pick(NAMES)}=abc&${cut(v)}`,
      (v) => `${cut(pick(NAMES))}="${v} two"`, (v) => `\x1b[32m${pick(NAMES)}=${v}\x1b[0m`, (v) => `"${cut(pick(NAMES))}": "${cut(v)}"`,
      (v) => `see ${cut(v)} here`, () => 'file \x1b[32ma.md\x1b[0m ok', () => 'plain words here', () => '\n',
    ];
    let vn = 0;
    return Array.from({ length: n }, () => {
      const vs: string[] = [];
      let t = '';
      for (let i = 0, k = 1 + Math.floor(rnd() * 5); i < k; i += 1) {
        const v = `hunter2q${(vn++).toString(36)}z`;
        const piece = pick(FR)(v);
        if (piece.replace(R11_CSI, '').includes(v)) vs.push(v);
        t += piece + pick([' ', '\n', ', ', '; ', '&']);
      }
      return { t: rnd() < 0.25 ? JSON.stringify({ text: t }) : t, vs };
    });
  };
  /** Every door, called on one text: its name, the door, and its arguments. */
  const r11Doors = (idx: libRedact.PairIndex): Array<[string, (...a: never[]) => unknown, (t: string) => unknown[]]> => [
    ['redactField', libRedact.redactField, (t) => [t, idx]], ['redactFinal', libRedact.redactFinal, (t) => [t, idx]],
    ['redactFinalLines', libRedact.redactFinalLines, (t) => [t, idx]], ['redactFinalJson', libRedact.redactFinalJson, (t) => [{ a: t }, idx]],
    ['redactFinalText', libRedact.redactFinalText, (t) => [t, idx]], ['redactForIndex', libRedact.redactForIndex, (t) => [t, idx]],
    ['redactForDisplay', libRedact.redactForDisplay, (t) => [t, idx]], ['entryIndexText', libRedact.entryIndexText, (t) => [t, idx]],
    ['sidecarIndexText', libRedact.sidecarIndexText, (t) => [Buffer.from(t), idx]],
    ['redactDisplayWindow', libRedact.redactDisplayWindow, (t) => [t, Math.floor(t.length / 4), Math.ceil((3 * t.length) / 4), idx]],
    ['displaySnippet', libRedact.displaySnippet, (t) => [t, ['hunter2q'], idx]],
  ];
  const r11Text = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x));
  it('(j9) every door is its v2 reading over its base reading (R11), and each v2 reading is subtractive over the base reading\'s output', () => {
    const idx = idxOf([]);
    const texts = [...f2Cases().map((c) => c.input), ...r11Corpus(0x5745, 600).map((c) => c.t), ...r11AnsiCorpus(0x1b5745, 300).map((c) => c.t)];
    const failed: string[] = [];
    for (const [name, door, args] of r11Doors(idx)) {
      const r = libRedact.redactDoorReadings(door);
      expect(r, `${name} has R11's readings`).not.toBeNull();
      for (const t of texts) {
        const base = r!.base(...args(t));
        const out = (door as (...a: unknown[]) => unknown)(...args(t));
        if (r11Text(out) !== r11Text(r!.v2(base, idx))) failed.push(`${name}: not v2(base): ${JSON.stringify(t)}`);
        const [bt, ot] = name === 'redactFinalJson' ? [(base as { a: string }).a, (out as { a: string }).a] : [r11Text(base), r11Text(out)];
        if (!r11Subtractive(bt, ot)) failed.push(`${name}: the v2 reading is not subtractive: ${JSON.stringify(bt)} -> ${JSON.stringify(ot)}`);
        // a window's base reading reads a slice of the text, so it is subtractive over that slice's readings, not the whole text's
        if (name !== 'redactDisplayWindow' && !r11Subtractive(t, bt)) failed.push(`${name}: the base reading is not subtractive: ${JSON.stringify(t)}`);
      }
    }
    expect(libRedact.redactDoorReadings(libRedact.makePairIndex), 'CONTROL: a function that is no door has none').toBeNull();
    expect(failed.slice(0, 5), `${failed.length} failed`).toEqual([]);
  }, 120_000);
  it('(j10) no door prints a value its rev 3.6 door masks: f2Cases (the (j3) corpus), four of the reviews\' shapes and two seeded corpora, one of them with colour sequences, through every door (R11)', () => {
    const idx = idxOf([]);
    const corpus = [
      ...f2Cases().map((c) => ({ t: c.input, vs: ['cdXQ9'] })),
      ...['PASSWORD="token: "hunter2xyz', "SECRET='password: 'hunter2xyz", 'PASSWORD=")hunter2xyz end', String.raw`{"text":"TOKEN=abc,\"api_key\": \"hunter2xyz\"}"}`]
        .map((t) => ({ t, vs: ['hunter2xyz'] })),
      ...r11Corpus(0x5746, 2000),
      ...r11AnsiCorpus(0x1b5746, 1000),
    ];
    let masked = 0;
    let separated = 0;
    let joined = 0;
    const printed: string[] = [];
    for (const [name, door, args] of r11Doors(idx)) {
      const r = libRedact.redactDoorReadings(door)!;
      for (const { t, vs } of corpus) {
        const base = r11Text(r.base(...args(t)));
        const out = r11Text((door as (...a: unknown[]) => unknown)(...args(t)));
        // the CONTROL: the widened rules over the raw text, which the composition is there to prevent
        const alone = name === 'sidecarIndexText' ? base : r11Text(r.v2(args(t)[0], idx));
        for (const v of vs) {
          // the composed door may print whole a value the base door prints split by a sequence (the joined reading); never one
          // that no reading of the base door's output holds
          if (!base.includes(v) && r11Holds(base, v) && out.includes(v)) joined += 1;
          if (r11Holds(base, v)) continue;
          masked += 1;
          if (r11Holds(alone, v)) separated += 1;
          if (r11Holds(out, v)) printed.push(`${name}: ${JSON.stringify(t)} prints ${v}`);
        }
      }
    }
    expect(masked, 'CONTROL: values the base doors mask').toBeGreaterThan(20_000);
    expect(separated, 'CONTROL: the widened rules read over the raw text print some of them').toBeGreaterThan(0);
    expect(joined, 'CONTROL: the composed door prints whole some values the base door prints split by a sequence').toBeGreaterThan(0);
    expect(printed.slice(0, 5), `${printed.length} of ${masked}`).toEqual([]);
  }, 120_000);
```

(j8) copies (m)'s ReDoS style (`:2698`): 1 MiB inputs, a 30 s ceiling per door, a 300 s case timeout, and the comment that the bound is a ceiling, not the detector. Its mutant is measured with a shell `timeout` (Step 6, M5), because a regex that backtracks exponentially blocks the event loop, so vitest's own timeout never fires.

(l) (`:2571`, "the union masks at least what either sequential order masked", D-4614's seeded union fuzz) is NOT edited: its frozen copies are of v1's field rules, and the composed doors mask at least what those masked (measured green in the whole file, Step 5).

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'D-5745|D-5021|R11' | grep -c 'history-lib')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5745|D-5021|R11')
```

Expected: the filter selects 9 tests: (j2), (j3), (j4), and (j5)–(j10). The run is red, `6 failed | 3 passed` (measured at `bd363a76b` with this step's tests):
- (j3): `named with "&": "password=ab&cdXQ9": the field pass must stay the guard (the final form alone prints something else): expected 'password=[redacted]&cdXQ9' not to be 'password=[redacted]&cdXQ9'`;
- (j5): `password=abc&def: expected 'password=[redacted]&def' to be 'password=[redacted]'`;
- (j4), (j7), (j9) and (j10): `TypeError: redactDoorReadings is not a function`.

(j2), (j6) and (j8) pass on v1. (j6) and (j8) are the structure and linearity CONTROLs, and their guards are measured by mutants in Step 6.

- [ ] **Step 4: Write the rule and the composition.** From the repository root, run this script. Each replacement asserts its anchor occurs exactly once; the script writes `ccd/history/lib.mjs` and `ccd/history/lib.d.mts` and prints one line.

```bash
python3 - <<'EOF'
p = 'ccd/history/lib.mjs'
s = open(p, encoding='utf-8').read()

def rep(old, new):
    global s
    assert s.count(old) == 1, (old[:80], s.count(old))
    s = s.replace(old, new)

# (a) the field form's value pattern, above contextRules' doc comment
rep("""/** Layer 2's rules (the context layer), one definition each, built twice:""",
"""/** The line ends a quoted value never crosses: CR, LF, U+2028 and U+2029, the last two built from their code points. */
const QUOTED_LINE_ENDS = String.raw`\\r\\n` + String.fromCharCode(0x2028, 0x2029);
/** D-5745 (history-redact-value-class-widened; closes D-5021's residual): the named rule's value in the FIELD form, read
 *  whole. v1's class `[^\\s"'`,;&]` ended a value at `&`, `;`, `,` and either quote, so `password=abc&def`,
 *  `password="abc&def"` and `PASSWORD='a b c'` printed their tails. Three alternatives, group 1 the opening quote:
 *  - after `"` or `'` (the lookbehind reads group 1), the value runs to the same closing quote on the same line, which
 *    the backreference `\\1` consumes; an empty quoted value matches and every caller reads it as no value;
 *  - unquoted, a value still ends at whitespace and the backtick. `&` ends it only before `NAME=` (a 256-character NAME,
 *    the head's own bound), and `,` `;` `"` `'` end it only before whitespace, a closer (`,` `;` `)` `}` `]`) or the end
 *    of the text, so `url?a=1&password=x&b=2`, `password=x; path=/` and `{"cmd":"password=x"}` keep their structure.
 *  An unclosed quote fails the quoted reading, and group 1 then backs off to empty, so the quote is read as the
 *  value's first character. Linear: each alternative's classes are disjoint, the lookaheads are bounded or one
 *  character, and a failed quoted reading costs its own line once. The final form keeps v1's class (D-4613's structure
 *  safety is unchanged). This is the prototype scope b2-redaction measured (R1). Every door reads it only over its rev
 *  3.6 door's output (R11, composeDoor), so it never prints a value that door masks. */
const NAMED_VALUE_FIELD_SRC = String.raw`(["']?)((?<=")[^"${QUOTED_LINE_ENDS}]*|(?<=')[^'${QUOTED_LINE_ENDS}]*|(?:[^\\s"'` + '`'
  + String.raw`,;&]|[,;"'](?![\\s,;)}\\]]|$)|&(?![A-Za-z_][A-Za-z0-9_.-]{0,255}=))+)\\1`;

/** Layer 2's rules (the context layer), one definition each, built twice:""")

# (b) contextRules' doc comment, last line
rep(""" *  field form is today's, byte for byte. */
function contextRules(final) {""",
""" *  field form is today's, byte for byte, except the named rule's value (D-5745). `base` builds the rev 3.6 rules, byte for
 *  byte, from the same template (BASE_RULES, R11); `final` is kept on the rules, which redactLayers reads. */
function contextRules(final, base = false) {""")

# (c) the final flag and the named value line
rep("""  const stop = final ? String.raw`\\\\<>&` : '';
  return Object.freeze({
""", """  const stop = final ? String.raw`\\\\<>&` : '';
  return Object.freeze({
    final,
""")
rep("""    namedValue: new RegExp(String.raw`(["']?)([^\\s"'` + '`' + String.raw`,;&${final ? String.raw`\\\\<>` : ''}]+)`, 'y'),""",
"""    // D-5745 (history-redact-value-class-widened): the value of the named rule. Group 1 is the opening quote or empty, group 2
    // the value; a caller's span is group 2's own, never the whole match (the field form consumes a closing quote). The final
    // form, and the rev 3.6 rules (`base`), keep v1's class from the base's own template; the field form reads a value whole.
    namedValue: new RegExp(final || base ? String.raw`(["']?)([^\\s"'` + '`' + String.raw`,;&${final ? String.raw`\\\\<>` : ''}]+)` : NAMED_VALUE_FIELD_SRC, 'y'),""")

# (d) the rev 3.6 rule set
rep("""const CONTEXT_RULES = Object.freeze({ field: contextRules(false), final: contextRules(true) });
""", """const CONTEXT_RULES = Object.freeze({ field: contextRules(false), final: contextRules(true) });

/** R11 (W5h-2; the coordinator's composition ruling of 2026-10-19, which amends R1 and R3): the rev 3.6 (BELT_VERSION 1)
 *  rules, frozen, built from contextRules' one template (`base`): v1's named value class in both forms. Every redaction
 *  door reads them first and CONTEXT_RULES over their output (composeDoor). Nothing else reads them. */
const BASE_RULES = Object.freeze({ field: contextRules(false, true), final: contextRules(true, true) });
""")

# (e) tailHead
rep("""    return [at + v[1].length, at + v[0].length];""",
"""    return [at + v[1].length, at + v[1].length + v[2].length];   // D-5745: the value group's own span""")

# (f) namedSpans
rep("""    head.lastIndex = addChain(s, R, sepEnd + v[1].length, sepEnd + v[0].length, 'named', add);""",
"""    const start = sepEnd + v[1].length;
    // D-5745: the span is the value group's own (the field form consumes a closing quote, which stays). An empty quoted
    // value (`TOKEN=""`) gives an empty span, which `add` drops: no value.
    head.lastIndex = addChain(s, R, start, start + v[2].length, 'named', add);""")

# (g) TOKEN_BREAK_RE's doc comment
rep("""/** A break between token spans: whitespace, or one of `"`, `'`, `` ` ``, `,`, `;` and `&`, the characters that end
 *  a value in layer 2's `NAME=` form (coordinator ruling on final-check W2). */""",
"""/** A break between token spans: whitespace, or one of `"`, `'`, `` ` ``, `,`, `;` and `&`, the characters that end
 *  a value in layer 2's `NAME=` form (coordinator ruling on final-check W2). Since D-5745 the field form reads a value
 *  past `&`, `,`, `;` and either quote where they do not end it (NAMED_VALUE_FIELD_SRC), so such a value is more than
 *  one token span: when its NAME sits more than ENTRY_REDACT_MARGIN before a window, it is spec §8.3's display
 *  residual (a match that is not one token span), as a quoted value already was. The spans are unchanged. */""")

# (h) the layers read one form's rules, handed in
rep("""function redactRun(segment, idx, context = true) {""", """function redactRun(segment, idx, context) {""")
rep("""  const R = context ? (context === 'final' ? CONTEXT_RULES.final : CONTEXT_RULES.field) : null;""",
"""  // R11: `context` is one form of one rule set (BASE_RULES or CONTEXT_RULES, `field` or `final`), or false for no layer 2.
  const R = context || null;""")
rep("""  if (R === CONTEXT_RULES.final) {
    const shapes = [];""", """  if (R !== null && R.final) {
    const shapes = [];""")
rep("""function redactLayered(text, idx, context = true) {""", """function redactLayered(text, idx, context) {""")

# (i) the doors
rep("""export function redactField(text, idx) {
  return redactFieldIn(text, idx, true);
}

/** redactField's body, with layer 2's mode (`true` the field form, `'final'` redactFinal's structure-safe form). */
function redactFieldIn(text, idx, context) {""",
"""export function redactField(text, idx) {
  return composeDoor(DOOR_READINGS.redactField, [text, idx], idx);
}

/** redactField's body, with layer 2's rules for one form (R11: a rule set's `field`, or its `final`, redactFinal's
 *  structure-safe form). */
function redactFieldIn(text, idx, context) {""")

rep("""export function redactForIndex(text, idx) {
  let t = redactIndexReading(text, idx);
  let keep = t;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const u = unescapeJsonText(t);
    if (u === t) return keep;
    t = redactIndexReading(u, idx);""",
"""export function redactForIndex(text, idx) {
  return composeDoor(DOOR_READINGS.redactForIndex, [text, idx], idx);
}

/** redactForIndex's body over one rule set (R11). */
function redactForIndexWith(text, idx, rs) {
  let t = redactIndexReading(text, idx, rs);
  let keep = t;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const u = unescapeJsonText(t);
    if (u === t) return keep;
    t = redactIndexReading(u, idx, rs);""")

rep("""export function sidecarIndexText(bytes, idx) {
  const w = windowText(bytes, SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN);""",
"""export function sidecarIndexText(bytes, idx) {
  return composeDoor(DOOR_READINGS.sidecarIndexText, [bytes, idx], idx);
}

/** sidecarIndexText's body over one rule set (R11). */
function sidecarIndexTextWith(bytes, idx, rs) {
  const w = windowText(bytes, SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN);""")
rep("""  if (idx !== null) text = redactIndexReading(text, idx);
  text = unescapeJsonText(text);
  if (idx !== null) text = redactForIndex(text, idx);""",
"""  if (idx !== null) text = redactIndexReading(text, idx, rs);
  text = unescapeJsonText(text);
  if (idx !== null) text = redactForIndexWith(text, idx, rs);""")

rep("""export function entryIndexText(text, idx) {
  const window = ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN;""",
"""export function entryIndexText(text, idx) {
  return composeDoor(DOOR_READINGS.entryIndexText, [text, idx], idx);
}

/** entryIndexText's body over one rule set (R11). */
function entryIndexTextWith(text, idx, rs) {
  const window = ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN;""")
rep("""  return cutIndexText(redactForIndex(w.text, idx), w.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN);""",
"""  return cutIndexText(redactForIndexWith(w.text, idx, rs), w.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN);""")

rep("""export function redactFinal(text, idx) {
  return redactFieldIn(text, idx, 'final');
}""", """export function redactFinal(text, idx) {
  return composeDoor(DOOR_READINGS.redactFinal, [text, idx], idx);
}""")

rep("""export function redactFinalJson(value, idx) {
  if (typeof value === 'string') return redactFinal(redactField(value, idx), idx);
  if (Array.isArray(value)) return value.map((v) => redactFinalJson(v, idx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactFinalJson(v, idx)]));
  }
  return value;
}""", """export function redactFinalJson(value, idx) {
  return composeDoor(DOOR_READINGS.redactFinalJson, [value, idx], idx);
}

/** redactFinalJson's body over one rule set (R11). */
function redactFinalJsonWith(value, idx, rs) {
  if (typeof value === 'string') return redactFieldIn(redactFieldIn(value, idx, rs.field), idx, rs.final);
  if (Array.isArray(value)) return value.map((v) => redactFinalJsonWith(v, idx, rs));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactFinalJsonWith(v, idx, rs)]));
  }
  return value;
}""")

rep("""export function redactFinalLines(text, idx) {
  return redactFinal(redactField(text, idx), idx);
}""", """export function redactFinalLines(text, idx) {
  return composeDoor(DOOR_READINGS.redactFinalLines, [text, idx], idx);
}""")

rep("""export function redactFinalText(text, idx) {
  return text.split('\\n').map((line) => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(FRAME_TAG_RE)) {
      out += redactFinal(line.slice(last, m.index), idx);
      let at = 0;
      for (const q of m[0].matchAll(/"([^"]*)"/g)) {
        out += `${redactFinal(m[0].slice(at, q.index), idx)}"${redactFinal(q[1], idx)}"`;
        at = q.index + q[0].length;
      }
      out += redactFinal(m[0].slice(at), idx);
      last = m.index + m[0].length;
    }
    return out + redactFinal(line.slice(last), idx);
  }).join('\\n');
}""", """export function redactFinalText(text, idx) {
  return composeDoor(DOOR_READINGS.redactFinalText, [text, idx], idx);
}

/** redactFinalText's body over one rule set (R11). */
function redactFinalTextWith(text, idx, rs) {
  const one = (segment) => redactFieldIn(segment, idx, rs.final);
  return text.split('\\n').map((line) => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(FRAME_TAG_RE)) {
      out += one(line.slice(last, m.index));
      let at = 0;
      for (const q of m[0].matchAll(/"([^"]*)"/g)) {
        out += `${one(m[0].slice(at, q.index))}"${one(q[1])}"`;
        at = q.index + q[0].length;
      }
      out += one(m[0].slice(at));
      last = m.index + m[0].length;
    }
    return out + one(line.slice(last));
  }).join('\\n');
}

/** R11 (W5h-2; the coordinator's composition ruling of 2026-10-19, which amends R1 and R3): each redaction door's two
 *  readings. `base(...args)` is the door as rev 3.6 built it (BASE_RULES); `v2(out, idx)` is the same door built from this
 *  build's rules (CONTEXT_RULES), read over `out`, the base reading's output. A text door reads that output as its text. A
 *  sidecar's v2 reading is the index redaction and the cut: its window and its first decode are readings of the raw bytes,
 *  which the base reading already took, and decoded again a JSON string held inside a JSON string would be indexed at its
 *  second level whether or not anything there is masked (D-4343's rule keeps a deeper level only when it masks something).
 *  A display window's or a snippet's v2 reading is redactForDisplay's, a window of the whole text (displayWindow's step 0).
 *  nodeIndexTexts, the --regex child, the node fields and the relay read these doors, so they are composed through them. */
const DOOR_READINGS = (() => {
  const door = (impl, over = impl) => Object.freeze({
    base: (...args) => impl(...args, BASE_RULES),
    v2: (out, idx) => over(out, idx, CONTEXT_RULES),
  });
  const shown = (out, idx, rs) => redactForDisplayWith(out, idx, rs);
  return Object.freeze({
    redactField: door((text, idx, rs) => redactFieldIn(text, idx, rs.field)),
    redactFinal: door((text, idx, rs) => redactFieldIn(text, idx, rs.final)),
    redactFinalLines: door((text, idx, rs) => redactFieldIn(redactFieldIn(text, idx, rs.field), idx, rs.final)),
    redactFinalJson: door(redactFinalJsonWith),
    redactFinalText: door(redactFinalTextWith),
    redactForIndex: door(redactForIndexWith),
    redactForDisplay: door((text, idx, rs) => redactForDisplayWith(text, idx, rs)),
    entryIndexText: door(entryIndexTextWith),
    sidecarIndexText: door(sidecarIndexTextWith, (out, idx, rs) => (idx === null ? out
      : cutIndexText(redactForIndexWith(out, idx, rs), false, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN))),
    redactDisplayWindow: door(redactDisplayWindowWith, shown),
    displaySnippet: door(displaySnippetWith, shown),
  });
})();

/** R11: a door of this build is its v2 reading over its base reading, v2(base(…)) (DOOR_READINGS). Every reading is
 *  SUBTRACTIVE: its output is its input, a JSON-escape decoding of it (the index and display readings), or its input with
 *  escape sequences removed (D-4307's joined reading), with spans replaced by the mark and, for an index text, cut, so it
 *  writes no character its input (so read) did not hold but a mark's (and a window's note). A value a door masks is one
 *  that no reading of its output holds: as written, decoded, or with its sequences removed. So the v2 reading never writes
 *  back a value the base reading masked, whatever the widened rules read: no door of this build prints a value its rev 3.6
 *  door masks, in that sense. Two residuals follow (D-5745): where the widened rules find a value only with the text's
 *  sequences removed, or only at a JSON-decoded level, the door returns that reading, so a value the base printed split by
 *  a sequence, or only JSON-escaped, prints whole. The cost is about two passes of the door. */
function composeDoor(r, args, idx) {
  const base = r.base(...args);
  return r.v2(base, idx);
}

/** R11's two readings of one exported door, or null for any other function: a read-only test accessor, which arms nothing
 *  (no env var, flag or file), read by history-lib's property, subtractiveness and mutant cases. No shipped file calls it. */
export function redactDoorReadings(door) {
  return DOOR_OF.get(door) ?? null;
}
const DOOR_OF = new Map([
  [redactField, DOOR_READINGS.redactField], [redactFinal, DOOR_READINGS.redactFinal],
  [redactFinalLines, DOOR_READINGS.redactFinalLines], [redactFinalJson, DOOR_READINGS.redactFinalJson],
  [redactFinalText, DOOR_READINGS.redactFinalText], [redactForIndex, DOOR_READINGS.redactForIndex],
  [redactForDisplay, DOOR_READINGS.redactForDisplay], [entryIndexText, DOOR_READINGS.entryIndexText],
  [sidecarIndexText, DOOR_READINGS.sidecarIndexText], [redactDisplayWindow, DOOR_READINGS.redactDisplayWindow],
  [displaySnippet, DOOR_READINGS.displaySnippet],
]);""")

# redactIndexReading over one rule set
rep("""function redactIndexReading(text, idx) {
  return beltMask(redactLayered(text, idx), idx.belt, false, beltHit(idx));
}""", """function redactIndexReading(text, idx, rs) {
  return beltMask(redactLayered(text, idx, rs.field), idx.belt, false, beltHit(idx));
}""")

rep("""export function redactForDisplay(text, idx) {
  if (text.length <= DISPLAY_READINGS_MAX) return redactForIndex(text, idx);
  const t = redactField(text, idx);
  if (!t.includes('\\\\')) return t;
  return t.replace(/[A-Za-z0-9_.\\\\-]+/g, (span) => (span.includes('\\\\') && /[A-Za-z0-9_-]/.test(span) && redactForIndex(span, idx) !== span ? REDACTED_MARK : span));
}""", """export function redactForDisplay(text, idx) {
  return composeDoor(DOOR_READINGS.redactForDisplay, [text, idx], idx);
}

/** redactForDisplay's body over one rule set (R11). */
function redactForDisplayWith(text, idx, rs) {
  if (text.length <= DISPLAY_READINGS_MAX) return redactForIndexWith(text, idx, rs);
  const t = redactFieldIn(text, idx, rs.field);
  if (!t.includes('\\\\')) return t;
  return t.replace(/[A-Za-z0-9_.\\\\-]+/g, (span) => (span.includes('\\\\') && /[A-Za-z0-9_-]/.test(span) && redactForIndexWith(span, idx, rs) !== span ? REDACTED_MARK : span));
}""")

# the display window's readings over one rule set
rep("""function displayReading(text, idx) {
  let t = redactIndexReading(text, idx);""", """function displayReading(text, idx, rs) {
  let t = redactIndexReading(text, idx, rs);""")
rep("""    t = redactIndexReading(deeper, idx);
    if (t !== deeper) {""", """    t = redactIndexReading(deeper, idx, rs);
    if (t !== deeper) {""")
rep("""function readingAt(text, idx, levels, bound) {
  let t = redactIndexReading(text, idx);
  for (let pass = 0; pass < levels; pass += 1) t = redactIndexReading(unescapeJsonText(t), idx);""",
"""function readingAt(text, idx, levels, bound, rs) {
  let t = redactIndexReading(text, idx, rs);
  for (let pass = 0; pass < levels; pass += 1) t = redactIndexReading(unescapeJsonText(t), idx, rs);""")
rep("""function inexactWindow(t, lo, hi, idx) {""", """function inexactWindow(t, lo, hi, idx, rs) {""")
rep("""  return { text: redactForDisplay(w, idx).replace(DISPLAY_SPAN_RE,""", """  return { text: redactForDisplayWith(w, idx, rs).replace(DISPLAY_SPAN_RE,""")
rep("""function displayWindow(text, from, to, idx) {""", """function displayWindow(text, from, to, idx, rs) {""")
rep("""  if (lo === 0 && hi === t.length) return { text: redactForDisplay(t, idx), exact: true };
  if (hi - lo > DISPLAY_WINDOW_MAX) return inexactWindow(t, lo, hi, idx);""",
"""  if (lo === 0 && hi === t.length) return { text: redactForDisplayWith(t, idx, rs), exact: true };
  if (hi - lo > DISPLAY_WINDOW_MAX) return inexactWindow(t, lo, hi, idx, rs);""")
rep("""  const read = displayReading(t.slice(a, b), idx);""", """  const read = displayReading(t.slice(a, b), idx, rs);""")
rep("""  const lefts = lo > a ? marginReadings(readingAt(t.slice(a, lo), idx, read.levels, read.bound)) : [''];
  const rights = b > hi ? marginReadings(readingAt(t.slice(hi, b), idx, read.levels, read.bound)) : [''];""",
"""  const lefts = lo > a ? marginReadings(readingAt(t.slice(a, lo), idx, read.levels, read.bound, rs)) : [''];
  const rights = b > hi ? marginReadings(readingAt(t.slice(hi, b), idx, read.levels, read.bound, rs)) : [''];""")
rep("""  if (s0 === -1 || e0 === -1) return inexactWindow(t, lo, hi, idx);""", """  if (s0 === -1 || e0 === -1) return inexactWindow(t, lo, hi, idx, rs);""")
rep("""  if (unmarkedLength(out) > (hi - lo) + 2 * DISPLAY_EDGE_SLACK) return inexactWindow(t, lo, hi, idx);""",
"""  if (unmarkedLength(out) > (hi - lo) + 2 * DISPLAY_EDGE_SLACK) return inexactWindow(t, lo, hi, idx, rs);""")
rep("""export function redactDisplayWindow(text, from, to, idx) {
  const w = displayWindow(text, from, to, idx);
  return w.exact ? w.text : `${DISPLAY_INEXACT_NOTE}\\n${w.text}`;
}""", """export function redactDisplayWindow(text, from, to, idx) {
  return composeDoor(DOOR_READINGS.redactDisplayWindow, [text, from, to, idx], idx);
}

/** redactDisplayWindow's body over one rule set (R11). */
function redactDisplayWindowWith(text, from, to, idx, rs) {
  const w = displayWindow(text, from, to, idx, rs);
  return w.exact ? w.text : `${DISPLAY_INEXACT_NOTE}\\n${w.text}`;
}""")
rep("""export function displaySnippet(text, terms, idx) {
  const content = String(text);""", """export function displaySnippet(text, terms, idx) {
  return composeDoor(DOOR_READINGS.displaySnippet, [text, terms, idx], idx);
}

/** displaySnippet's body over one rule set (R11). */
function displaySnippetWith(text, terms, idx, rs) {
  const content = String(text);""")
rep("""  const w = displayWindow(content, from, to, idx);
  const shown = snippetWindow(w.text, terms);""", """  const w = displayWindow(content, from, to, idx, rs);
  const shown = snippetWindow(w.text, terms);""")

open(p, 'w', encoding='utf-8').write(s)

d = 'ccd/history/lib.d.mts'
t = open(d, encoding='utf-8').read()
old = "export function redactFinalLines(text: string, idx: PairIndex): string;\n"
assert t.count(old) == 1
t = t.replace(old, old + """/** R11: an exported redaction door's two readings, its rev 3.6 door (`base`) and the same door built from this build's
 *  rules over the base reading's output (`v2`); null for any other function. A test seam: no shipped file calls it. */
export function redactDoorReadings(door: (...args: never[]) => unknown):
  { base: (...args: any[]) => any; v2: (out: any, idx: PairIndex | null) => any } | null;
""")
open(d, 'w', encoding='utf-8').write(t)
print('Task 1: lib.mjs and lib.d.mts written')
EOF
```

What it writes, by its comments:
- (a) `QUOTED_LINE_ENDS` and `NAMED_VALUE_FIELD_SRC`, the prototype (R1);
- (b) and (c) `contextRules(final, base = false)`, its `final` flag and its `namedValue` line: the field form reads `NAMED_VALUE_FIELD_SRC`, and the final form and `base` read the base's own template, unchanged;
- (d) `BASE_RULES`;
- (e) and (f) the value group's own span in `tailHead` and `namedSpans`;
- (g) `TOKEN_BREAK_RE`'s doc comment;
- (h) `redactRun`, `redactLayers` and `redactLayered` take one form of one rule set, with no default;
- (i) each door's body as a `…With(…, rs)` function and its export as `composeDoor` over `DOOR_READINGS`; `redactDoorReadings` and its declaration; the readings of `redactIndexReading`, `redactForDisplay` and the display window over one rule set.

Check afterwards:
- `grep -c '^export function redactDoorReadings(' ccd/history/lib.mjs ccd/history/lib.d.mts` prints 1 for each file, and `grep -rl 'redactDoorReadings' ccd/ shared/` lists only `ccd/history/lib.mjs` and `ccd/history/lib.d.mts`;
- in `lib.mjs`: `grep -c 'NAMED_VALUE_FIELD_SRC'` prints 3 (its declaration, the `namedValue:` line and `TOKEN_BREAK_RE`'s doc comment); `grep -c 'BASE_RULES'` prints 5; `grep -c 'composeDoor'` prints 14 (its definition, the eleven doors' calls, and the doc comments of `NAMED_VALUE_FIELD_SRC` and `BASE_RULES`); `grep -c '^function contextRules(final, base = false) {$'` prints 1; and `grep -cE '^function (redactForIndexWith|sidecarIndexTextWith|entryIndexTextWith|redactFinalJsonWith|redactFinalTextWith|redactForDisplayWith|redactDisplayWindowWith|displaySnippetWith)\('` prints 8;
- `python3 -c "import sys; b=open('ccd/history/lib.mjs','rb').read(); print(b.count(bytes([0xe2,0x80,0xa8])), b.count(bytes([0xe2,0x80,0xa9])))"` prints `0 0`. The separators are built from code points, never written raw, so `source-bytes.test.ts` stays green. Measured: 0 and 0 in lib.mjs. f2Cases.ts already held 4 raw U+2028, and still holds 4.

The diff against the base is 184 lines added and 49 removed in 28 hunks of `lib.mjs` (measured; 180 before the plan's seventh review rewrote `composeDoor`'s doc comment), and one declaration in `lib.d.mts`.

- [ ] **Step 5: Run them and see them pass, then the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5745|D-5021|R11')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected (measured on a copy of `bd363a76b` with Tasks 1–3):
- the first run: `9 passed`. (j8) takes about 3.7 s, (j10) about 6 s and (j9) about 3 s, at a load average of about 40 (1.6 s and 0.7 s there without the colour-sequence corpus); the rest take milliseconds;
- `history-lib.test.ts` green as a whole, (l) included: the base's 1083 plus this task's 6, `1089`, with Task 1 alone (predicted); measured as `1124 passed` with Tasks 1–3 (Task 2 adds 23 cases and Task 3 12), in about 107 s, and in 160 s with the plan's sixth review's colour-sequence inputs, at a load average of about 35. After 5h-1 it is 5h-1's count plus 6;
- tsc prints nothing for any history file. The only lines measured were the worktree install's (`agent/src/server.ts` and `test/workflow-yaml-parses.test.ts`, which name modules that are not installed).

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The replacement text is read from a quoted heredoc, so no backtick or quote in it is expanded. Measured on a copy of `bd363a76b` with Tasks 1–3 applied; M8 names Task 1's `return r.v2(base, idx);`, which Task 2 rewrites as `const out = r.v2(base, idx);` (the mutant was measured on that line).

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h2/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file>: stdin is OLD, a line "=====", then NEW; one exact replacement, asserted to match once
  python3 -c '
import sys
p = sys.argv[1]
old, new = sys.stdin.read().split("\n=====\n")
new = new[:-1] if new.endswith("\n") else new
s = open(p, encoding="utf-8").read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, "w", encoding="utf-8").write(s.replace(old, new))
' "$1"
}
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"

# M1: the field form's v1 class restored (D-5021's residual comes back).
mut ccd/history/lib.mjs <<'EOF'
 : NAMED_VALUE_FIELD_SRC, 'y'),
=====
 : String.raw`(["']?)([^\s"'` + '`' + String.raw`,;&]+)`, 'y'),
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5745|D-5021')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 4 failed | 3 passed: (j3) "named with "&" … expected 'password=[redacted]&cdXQ9' not to be
# 'password=[redacted]&cdXQ9'", (j4) "CONTROL: both field passes leave the JSON value", (j5) "password=abc&def: expected
# 'password=[redacted]&def' to be 'password=[redacted]'", (j7)'s CONTROL "the widening changes".

# M2: `&` `,` `;` and the quotes admitted unconditionally (the over-mask the lookaheads prevent).
mut ccd/history/lib.mjs <<'EOF'
,;&]|[,;"'](?![\s,;)}\]]|$)|&(?![A-Za-z_][A-Za-z0-9_.-]{0,255}=))+)\1`;
=====
,;&]|[,;"'&])+)\1`;
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the widened value keeps structure')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): url?a=1&password=x&b=2: expected 'url?a=1&password=[redacted]' to be 'url?a=1&password=[redacted]&b=2'.

# M3: namedSpans takes the span from the whole match (the old arithmetic), so the closing quote is masked too.
mut ccd/history/lib.mjs <<'EOF'
    head.lastIndex = addChain(s, R, start, start + v[2].length, 'named', add);
=====
    head.lastIndex = addChain(s, R, start, sepEnd + v[0].length, 'named', add);
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the field form reads a named value whole')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): password="abc&def": expected 'password="[redacted]' to be 'password="[redacted]"'.

# M3b: the quoted alternatives dropped, so a quoted value ends at its first space again.
mut ccd/history/lib.mjs <<'EOF'
((?<=")[^"${QUOTED_LINE_ENDS}]*|(?<=')[^'${QUOTED_LINE_ENDS}]*|(?:
=====
((?:
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the field form reads a named value whole')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): PASSWORD='a b c': expected 'PASSWORD=[redacted] b c\'' to be 'PASSWORD=\'[redacted]\''.

# M3c: tailHead takes the span from the whole match.
mut ccd/history/lib.mjs <<'EOF'
    return [at + v[1].length, at + v[1].length + v[2].length];   // D-5745: the value group's own span
=====
    return [at + v[1].length, at + v[0].length];
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the field form reads a named value whole')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected 'password=[redacted]\'[redacted] end' to be 'password=[redacted]\'[redacted]\' end'.

# M4: a value that merely starts with the mark is skipped, so a stored v1 output never heals, and over the base door's output
# (R11) the widening reads almost nothing.
mut ccd/history/lib.mjs <<'EOF'
    if (v === null || v[2] === REDACTED_MARK) {
=====
    if (v === null || v[2].startsWith(REDACTED_MARK)) {
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'a stored v1 output heals')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): CONTROL: the widening changes "password=abc&def": expected 'password=[redacted]&def' not to be
# 'password=[redacted]&def'.

# M5: an unquoted alternative that overlaps the first: exponential backtracking on an open quote. The regex blocks the
# event loop, so the bound is the shell's: `timeout` signals its whole process group, the vitest workers included.
mut ccd/history/lib.mjs <<'EOF'
,;&]|[,;"'](?![\s,;)}\]]|$)|&(?!
=====
,;&]|[^\s&](?![\s,;)}\]]|$)|&(?!
EOF
(cd server && timeout 120 ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the widened named value stays linear'; echo "exit $?")
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): no summary line, then "exit 124" after 120 s, on (j8)'s open quote over `x&` (Choices). Outside
# vitest the mutant took 24, 45, 89 and 199 ms at 11 to 14 units; the shipped pattern 0 to 4 ms.

# M6: a quoted value must hold a character, so an empty one is read unquoted.
mut ccd/history/lib.mjs <<'EOF'
((?<=")[^"${QUOTED_LINE_ENDS}]*|
=====
((?<=")[^"${QUOTED_LINE_ENDS}]+|
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the widened value keeps structure')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): TOKEN="": expected 'TOKEN=[redacted]"' to be 'TOKEN=""'.

# M7: the final form takes the field form's reading (D-4613's structure safety lost).
mut ccd/history/lib.mjs <<'EOF'
    namedValue: new RegExp(final || base ? String.raw`(["']?)(
=====
    namedValue: new RegExp(base ? String.raw`(["']?)(
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the field form reads a named value whole')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): CONTROL: the final form is unchanged (D-4613): password=abc&def: expected 'password=[redacted]' to be
# 'password=[redacted]&def'.

# M8 (R11): the widened reading runs on the raw text instead of the base door's output (the composition dropped for every text door).
mut ccd/history/lib.mjs <<'EOF'
  return r.v2(base, idx);
=====
  return r.v2(typeof args[0] === 'string' ? args[0] : base, idx);
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'R11')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 2 failed: (j9) `3900 failed: expected [ …(5) ] to deeply equal []` (each door is no longer v2(base))
# and (j10) `3363 of 44422: expected [ …(5) ] to deeply equal []` (values the base door masks, printed).

# M9 (R11): the base rule set built from the widened rules, so the base reading is no longer the rev 3.6 door.
mut ccd/history/lib.mjs <<'EOF'
const BASE_RULES = Object.freeze({ field: contextRules(false, true), final: contextRules(true, true) });
=====
const BASE_RULES = Object.freeze({ field: contextRules(false), final: contextRules(true, true) });
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'R11|D-5745|D-5021')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 3 failed | 6 passed: (j4) "CONTROL: both field passes leave the JSON value", (j5)
# "PASSWORD="token: "hunter2xyz: expected 'PASSWORD="[redacted]"hunter2xyz' to be 'PASSWORD="[redacted]"[redacted]'" and (j7)
# "the base reading is v1's: "password=abc&def": expected 'password=[redacted]' to be 'password=[redacted]&def'". (j10) stays
# green under it: it measures against the base reading, which this mutant moves; (j7) is the pin that the base reading is v1's.

# M10: redactFinalLines' readings without their final pass.
mut ccd/history/lib.mjs <<'EOF'
    redactFinalLines: door((text, idx, rs) => redactFieldIn(redactFieldIn(text, idx, rs.field), idx, rs.final)),
=====
    redactFinalLines: door((text, idx, rs) => redactFieldIn(text, idx, rs.field)),
EOF
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the final pass of redactFinalLines masks')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): the final pass takes it: expected '"api_key":"hunter2xyz:token=[redacted…' to be '"api_key":"[redacted]"'.

cmp ccd/history/lib.mjs "$SCRATCH/lib.orig" && echo restored
git diff --stat -- ccd/history   # lib.mjs and lib.d.mts show only this task's edits
```

Then run Step 5's first two commands once more: green.

- [ ] **Step 7: Amend the spec sentence.** In `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, §8.3 layer 2 ("Context"), replace the one line
```markdown
   - the value after `NAME=`, `NAME: ` or `"name": "` when NAME matches `:23`;
```
with
```markdown
   - the value after `NAME=`, `NAME: ` or `"name": "` when NAME matches `:23`. In the field pass, the value after `NAME=` or `NAME: ` is read whole (W5h-2's D-5745, which closes D-5021's residual). A quoted value (`"` or `'`) runs to its closing quote on the same line, and an empty one is no value. An unquoted value ends at whitespace and the backtick; it ends at `&` only before `NAME=`, and at `,`, `;`, `"` or `'` only before whitespace, a closer (`,`, `;`, `)`, `}`, `]`) or the end of the text; an unclosed quote is the value's first character. Every output path reads these rules only over the output of the same path built from the narrower class, as rev 3.6 built it (W5h-2's R11, the coordinator's composition ruling): every path only replaces spans by the mark, decodes JSON escapes or removes escape sequences (the joined reading of D-4307), writing no character its input did not hold, so the wider reading can never print a value the narrower path masked, that is, one that no reading of that path's output holds, as written, decoded or with its sequences removed. Removing a sequence glues the text either side of it, so where the wider reading finds a value only with a text's sequences removed, a value the narrower path printed split by a sequence prints whole (a named residual). Likewise, where the wider reading finds a value only at a JSON-decoded level, the path returns that level, so a value the narrower path printed escaped prints decoded, and an index row gains it as one term (a named residual). Where the narrower path's mark already took a NAME in, the wider reading finds no head there, and the value after it is read as the narrower path read it (a named residual). The second belt's final form keeps the narrower class, so its structure safety is unchanged (D-4613). The costs, accepted by the coordinator's default in the operator's place (the operator may change it): a quoted prose value after a secret NAME (`token: "…"`) is masked to its closing quote, and each output path runs about twice;
```
First check that the anchor is unique: `grep -c '^   - the value after `NAME=`, `NAME: ` or `"name": "` when NAME matches `:23`;$' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` prints 1. No test reads this sentence; the spec is cited only in test file headers.

- [ ] **Step 8: Run the neighbours that read the redaction rule.** In the foreground, with a timeout of at least 600000 ms each. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-parser.test.ts test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts)
```

Expected: green. Measured on a copy of `bd363a76b` with Tasks 1–3 applied (each count holds Tasks 2 and 3's own cases; with Task 1 alone they are the base's, predicted), except source-bytes:
- `history-cli`: `72 passed | 1 skipped`. H-32's F2 case now carries the named form's 5 new whole cases through `errLine`;
- `history-maint`: `126 passed` (the base's 118, Task 2's 1 and Task 3's 7), about 2 min. The relay's F2 case prints each new whole case as the field door's own output, on both streams;
- `history-recall`: `192 passed | 1 skipped`;
- `history-ingest`: `164 passed` (the base's 163 and Task 2's 1);
- `history-parser` and `history-derive`: `102 passed` and `48 passed`;
- `single-definition -t 'ccrc history'`: `93 passed` (Task 3's VOCABS entry adds one to the base's 92);
- the other history suites, each alone: `history-card` 63, `history-drain` 165, `history-holds` 42, `history-op` 108, `history-store` 132, `history-sweep` 37, `history-recover` 139, `history-export` 84 and `history-skill` 25 passed;
- `source-bytes`: green, predicted. It walks `git ls-files`, so it was not run on the scratch copy; Step 4's byte check stands in for it.

After 5h-1 lands, each count is 5h-1's own. A red here that names a redaction output is this task's to read: re-expect it only where the expected text was v1's tail, or where the second reading of a composed door masks more, and say so in the commit.

- [ ] **Step 9: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts server/test/fixtures/history/f2Cases.ts \
  docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git commit -m "feat(history): the field form reads a named value whole, closing D-5021's residual, and every redaction door reads the widened rules over its rev 3.6 door's output (W5h-2 Task 1, D-5745, R11)"
```

The CodeQL `js/redos` check reads `NAMED_VALUE_FIELD_SRC` on the PR. If it opens a thread, the evidence is (j8) and M5. The thread is the coordinator's to answer, and it blocks an admin merge until it is resolved.

### Task 2: stored text is re-cleaned under the widened class, as a sweep phase

Task 1 widens layer 2's named value class in its field form (D-5745) and composes every redaction door over its rev 3.6 door (R11). Read paths heal on deploy: display, the relay, `errLine` and the `--regex` child all redact at read time. Stored text does not heal on deploy. A BELT_VERSION 1 build (B4, W5h-1) wrote `blobs_fts` rows (contentless), `nodes.gist`, `nodes.topics`, `node_refs.value` and `nodes_fts` rows under the old class, so `password=abc&<tail>` left `<tail>` as an index term of its own and in node fields. Under R3, taken by the coordinator in the operator's place under the operator's directive of 2026-10-19 (the operator may change it), and as R11 amends it, the store is re-cleaned by the sweep, with no operator step:
- `BELT_VERSION` goes from 1 to 2. `decideBelt` then reads every store as due, and the tick's re-derivation opens one belt generation from cursor 0 (§6.2 "When a belt generation opens"). That reuses the generation, its restart rules, the rollback witness and the node belt step.
- **The walk rewrites a row exactly when the composed door's index text differs from its rev 3.6 reading, which on a store a BELT_VERSION 1 build wrote is the stored text** (R3 as R11 amends it). Every later re-derivation, a pair-owed walk or a roll-forward after a rollback included, rewrites those rows again with the text they already hold (the cost paragraph below). Under a re-derivation probe (`makeProbeIndex` with `beltAll`, which is what `rederiveFts` builds), `composeDoor` counts one owed hit when a door's v2 reading changes its base reading's text. The base reading is the rev 3.6 door, which is what wrote the stored row, so that hit IS the comparison of the composed text with the stored one, made without the stored text (`blobs_fts` is contentless). `rederiveFts` already rewrites only rows whose probe counted a hit (`idx.probe.hits > 0`), so the generation rewrites those rows, plus any row with a pair above the mark or a layer-4 or glue-window hit, as every generation does. The comparison replaces the rule-hit probe this plan first wrote (R3): it is simpler and sound (below), with no predicate, no group arithmetic, one condition in one function.
- **A rewrite never un-masks a stored row.** The text written is the stored text's v2 reading, which is subtractive (Task 1), so every value the stored row masked stays masked. It can add a term: where the v2 reading finds a value only at a JSON-decoded level, or only with the text's escape sequences removed, the text written is that reading, so a value the stored row held only escaped, or split by a sequence, is indexed as one term (Task 1's two residuals of that mechanism, D-5745; the plan's sixth and seventh reviews). The fifth review's shape, a row whose rewrite the widened rules alone would have un-masked (a `NAME=value` glued to an escaped JSON pair), is pinned below.
- Nodes heal with no code change. `beltNodesStep` (`derive.mjs`) re-redacts each stored gist, topic and ref through the composed `redactField`, and `redactNodeFields` rewrites them and their `nodes_fts` row. Re-redacting a v1 output gives the same result as redacting the raw text (`password=[redacted]&def` becomes `password=[redacted]`; scope b2-redaction measured this on 26 probe inputs, and Task 1's (j7) pins it, the base reading of the v1 output being the v1 output itself), so the node fields heal without their source text.

There is no schema change, no new meta key and no new step. Grep stays available throughout: rows not yet rewritten keep serving until the walk reaches them. `doctor --repair` stays the operator's manual alternative and is not the path (R3). The departure is D-5746 (`history-belt-v2-value-class-reindex`).

**Why the comparison is sound: it never undercounts.** A BELT_VERSION 1 build stored, for each row, its rev 3.6 door's index text under the pair answers of its time. This build's base reading is that door, byte for byte (Task 1: measured equal to `bd363a76b`'s own doors on 660,000 door readings, and (j7) pins the field door's). By the owed-pair argument (`makeProbeIndex`'s docstring), a recomputation that counts no owed pair hit and no belt hit asks the same questions and gets the same answers as the stored row's, so its base reading IS the stored text. With no composition hit either, the composed text is that base reading. So a row with no hit already holds this build's text. A sidecar's walk text is two doors, `sidecarIndexText` and then `entryIndexText`, each composed and each counting; with no hit in either, each answers its base reading, so the row is the stored one. Measured on a copy of `bd363a76b` with Tasks 1–3, against `bd363a76b`'s own lib, over 60,000 escape-dense fuzzed texts (three seeds of 20,000, read as entries and as sidecars): every index text that changed counted a hit, none counted a hit without changing, and no rewritten text held a planted value the stored text masked (entries 12,008, 12,027 and 12,105 changed per run, sidecars 11,979, 11,997 and 12,088). On a corpus of this repository's code and docs in 29,495 4-KiB rows (112 MiB), 204 rows changed (0.69%), each a hit.

**What it costs.** The walk's redaction reads each row twice (Task 1's composition): `entryIndexText` over that corpus took 17.8 to 19.4 s against 9.2 to 9.7 s at `bd363a76b` (three runs each, one box under a load average of about 13), 1.9 to 2.0 times. The comparison itself is one string comparison per door call. Every later generation counts the changed rows again: a pair-owed generation finds the stored row's text, which this build wrote, differing from its base reading, and rewrites it with the same text. That is an extra rewrite and no change of text, as a layer-4 hit already is.

**Files:**
- Modify: `ccd/history/lib.mjs`. Line numbers were measured at `bd363a76b`; re-anchor by the quoted content on `main` after wave 5h-1 and Task 1:
  - in `composeDoor`, which Task 1 wrote, its one line `  return r.v2(base, idx);`;
  - the `BELT_VERSION` docstring and declaration (`:6094-6098`), whose last docstring line is `` *  to layer 4, to the glue windows, to beltWidth, to beltFold or to the seed rule. */`` and whose declaration is `export const BELT_VERSION = 1;`.

  Wave 5h-1 edits `HEALTH_WORDS`, `deriveHealth`, `HEALTH_REMEDIES` and `remedyFor`, and appends sections at the end of the file. Neither hunk here lies in those regions. Keep each as its own hunk.
- Test: `server/test/history-lib.test.ts`:
  - in the describe `'the substring belt (W1-B2 Task 7A; spec §8.3 layer 4, §6.2; O59 lib half)'`, the case `'publishes the exact frozen belt contract Task 7B and Task 14 consume'`: its line `    expect(libRedact.BELT_VERSION).toBe(1);` (`:6439`);
  - one describe appended at the end of the file. The namespace import `libRedact` (`:35`) and `f2Cases` (`:15`) cover every name used.
- Test: `server/test/history-ingest.test.ts`. One describe appended at the end of the file. It uses `IX`, `IxSweep` (its merged members `rederiveFts`, `makeIngestCtx`, `ftsPrepare`, `newBudget`, `ftsTextOfBlob`), `randomBytes`, `fs` and `DatabaseSync`, all already in scope, and adds no import.
- Test: `server/test/history-maint.test.ts`:
  - the lib import block (`:18-21`): `entryIndexText` is appended to the line that ends `formatBeltState, BELT_META, backupNameOf,`;
  - the sweep import line (`:23`): `beltWitness` and `ftsTextOfBlob` are added;
  - one describe appended at the end of the file. It reuses the module-level `ID`, `MAINT_U1`, `HEAVY`, `dbFile`, `maintQ`, `maintMeta` and `maintMatch`, plus `getMeta` and `setMeta` from the store import.
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, §6.2. Two edits:
  - the sentence `Layer 4 and the glue windows read the values the tick loaded and code that \`BELT_VERSION\` tags, which the owed-pair argument of the re-derivation does not cover.` in the bullet `**The belt's state.**` (`:931`);
  - one new bullet directly above `  - **When a belt generation opens, and when it restarts.**` (`:937`).

  Wave 5h-1 amends §6.1, §8.4 and §9.x, and Task 1 amends §8.3; neither touches §6.2.
- Not edited:
  - `ccd/history/sweep.mjs`: `rederiveFts` (`:5960-6052`) is the consumer. It already builds its index with `beltAll: true` (`:5988`), already rewrites only on `idx.probe.hits > 0` (`:6036`), and already restarts `BELT_NODES_STEP` when a generation opens (`:5981`);
  - `ccd/history/derive.mjs`: `beltNodesStep` (`:1285-1336`) and `redactNodeFields` (`:1071`) are the node half, read in Step 1;
  - `ccd/history/lib.d.mts`: `BELT_VERSION` is declared `number` (`:728`), and `composeDoor` is module-private;
  - `server/test/single-definition.test.ts`: no new constant;
  - `server/test/fixtures/history/f2Cases.ts`: Task 1's.

**Interfaces:**
- Consumes (Task 1, `lib.mjs` and `lib.d.mts`):
  - `composeDoor(r, args, idx)`, whose base reading is the rev 3.6 door and whose v2 reading reads the widened rules over its output;
  - `redactDoorReadings(door)`, the test seam, through which the pure cases read `entryIndexText`'s and `sidecarIndexText`'s base readings.
- Consumes (base):
  - `lib.mjs`: `beltHit(idx)` (`() => void` or `null`), `makeProbeIndex(pairs, mark, { belt, beltAll })`, `entryIndexText(text, idx)`, `sidecarIndexText(bytes, idx)`, `makePairIndex(pairs)`, `decideBelt(state, live, mark)`, `rederivePlan(mark, top, maxBlobId, state, beltDue, restart)`, `formatBeltState`, `parseBeltState`, `BELT_META`, `REDACTED_MARK`;
  - `sweep.mjs`: `rederiveFts(db, ctx, budget, slice?) -> Promise<{ state: 'idle' | 'running' | 'completed'; reindexed: number }>`, `beltWitness(db) -> string`, `ftsTextOfBlob(z, isSidecar, pairIdx, rawLen)`;
  - `derive.mjs`: `beltNodesStep(db, ictx, slice)`.
- Produces:
  - `lib.mjs`: `export const BELT_VERSION = 2`;
  - in `composeDoor`, under a re-derivation probe (`beltHit(idx)` not null), one owed hit when the v2 reading's text differs from the base reading's. Every other index (`beltHit` null, or a null `idx`) counts nothing, so capture, display and the relay pay one string comparison per door call;
  - no new export, no declaration change, no meta key, no step, no schema change.

**Spec:** §6.2 "The belt's state" and a new §6.2 bullet "Which rows a belt generation rewrites" (Step 10). Departure D-5746 (`history-belt-v2-value-class-reindex`), with its line in "Deviations found". Rulings: R3, taken by the coordinator in the operator's place under the operator's directive of 2026-10-19 (the operator may change it) (a sweep phase; `BELT_VERSION` 1 to 2; no schema change, no new meta key, no new step; `doctor --repair` is not the path), and amended by R11 (the walk rewrites exactly when the composed index text differs from its rev 3.6 reading, the stored text on a store a BELT_VERSION 1 build wrote; a later generation rewrites those rows again with the same text); R1 (the widening this re-cleans is Task 1's) and R8 (5h-1 lands first; separate hunks). Departure consumed: D-5745 (Task 1's composition).

**Choices this task makes:**
- **The hit is the comparison, counted in `composeDoor`.** It needs nothing from the widened rule: no predicate over a value's characters, no reading of a JSON-form scan's resume points, and so nothing to keep in step with Task 1's pattern. A rule-hit kept beside it would have to be proved never to undercount against this comparison, which is what it would be measured against.
- **The comparison is the string's, after the v2 reading.** A door answers a string for every index text, so `out !== base` is exact. `redactFinalJson` answers a value, which is never read under a probe, and the condition requires a string.
- **The fixture stamp is the literal `1`, never `BELT_VERSION - 1`.** That is what every B4 and W5h-1 build stamps. A stamp of `BELT_VERSION - 1` would read 0 under the mutant that leaves `BELT_VERSION` at 1, and 0 is the due record, which opens a generation anyway and hides the mutant.
- **The end-to-end plant re-stamps the witness in a transaction of its own,** after the index writes have committed. A witness read inside the transaction that wrote `blobs_fts` may be behind (§6.2 "Witness timing"), and a moved witness records the belt due whatever the version, which would hide the same mutant.
- **The CONTROL is two-sided.**
  - In process, `rederiveFts`' own `reindexed` count is exactly 1 over three rows: a widened value, a named value v1 already masked whole, and a plain row. Counting every composed door makes it 3; a forced rewrite makes it 3.
  - End to end, a row with no named value carries a sentinel term the re-derivation never writes, and the sentinel must survive the generation.
  - In the pure describe, a row counts a hit exactly when the composed index text differs from the base reading, over f2Cases and the two tables, through `entryIndexText` and `sidecarIndexText`.

- [ ] **Step 1: Confirm Task 1's names, and read the consumers that need no change.** From the repository root:

```bash
grep -c '^export function redactDoorReadings(' ccd/history/lib.mjs
grep -c '^function composeDoor(r, args, idx) {$' ccd/history/lib.mjs
grep -c '^  return r.v2(base, idx);$' ccd/history/lib.mjs
node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); const i = l.makeProbeIndex([], 0, { beltAll: true }); console.log(l.entryIndexText('note password=abc&def end', i), i.probe.hits, l.BELT_VERSION)"
grep -c '^export const BELT_VERSION = 1;' ccd/history/lib.mjs
grep -c '    { belt: ctx.pairIdx?.belt ?? null, beltAll: true });' ccd/history/sweep.mjs
grep -c '          if (idx.probe.hits > 0) { group.push({ id: b.blob_id, text: final }); chars += final.length; }' ccd/history/sweep.mjs
grep -c '      secretStmts(db).restartStep.run(BELT_NODES_STEP);' ccd/history/sweep.mjs
grep -c '  const changes = (s) => s !== null && s !== undefined && redactField(s, ictx.pairIdx) !== s;' ccd/history/derive.mjs
grep -c '      const gist = row.gist === null ? null : redactField(row.gist, ictx.pairIdx);' ccd/history/derive.mjs
```

Expected:
- every count is 1;
- the node line prints `note password=[redacted] end 0 1`: Task 1 masks the value whole, and the probe counts nothing yet. `lib.mjs` is L1, and the line reads no file and no HOME.

The last five counts are this task's reading of the consumers (measured 1 each at `bd363a76b`):
- `rederiveFts` probes with `beltAll`, rewrites only on a hit, and restarts the node belt step when a generation opens;
- `beltNodesStep` marks a node dirty when `redactField` of its stored field differs from what it stores;
- `redactNodeFields` rewrites from the stored field, never from source text.

So the nodes heal with no code change. If `redactDoorReadings` or `composeDoor` is absent, or the line prints the tail, Task 1 is not on this base: stop and report.

- [ ] **Step 2: Write the failing pure tests.** In `server/test/history-lib.test.ts`, in the case `'publishes the exact frozen belt contract Task 7B and Task 14 consume'`, replace the one line

```ts
    expect(libRedact.BELT_VERSION).toBe(1);
```

with

```ts
    expect(libRedact.BELT_VERSION).toBe(2);   // W5h-2 Task 2 (D-5746): layer 2's widened named value class
```

Then append at the end of the file:

```ts

// ── W5h-2 Task 2: stored text is re-cleaned under the widened class, as a sweep phase (D-5746 (history-belt-v2-value-class-reindex)) ─
// Pure. Every redaction door is its v2 reading over its rev 3.6 reading (Task 1, R11). Under a re-derivation probe (makeProbeIndex
// with beltAll, rederiveFts' index) a door whose v2 reading changes the base reading's text counts one owed hit, so the belt
// generation BELT_VERSION 2 opens rewrites exactly the rows whose index text this build writes otherwise than a BELT_VERSION 1
// build wrote it (R3 as R11 amends it). The CONTROL inputs below print what B4 printed (each `v1` literal measured at bd363a76b)
// and count no hit.
describe('W5h-2 Task 2: a re-derivation probe counts each row the composed index text changes, and BELT_VERSION is 2 (D-5746)', () => {
  const M = libRedact.REDACTED_MARK;
  /** The owed hits one index text counts under a probe index with no pair (so no layer-1, glue or layer-4 hit can count). */
  const hitsOf = (text: string, beltAll = true): number => {
    const idx = libRedact.makeProbeIndex([], 0, { beltAll });
    libRedact.entryIndexText(text, idx);
    return idx.probe.hits;
  };
  // [why, input, the value the widened class takes]
  const WIDENED: Array<[string, string, string]> = [
    ['an ampersand not before NAME=', 'note password=zqa&zqtail7 end', 'zqa&zqtail7'],
    ['a semicolon before a word', 'note password=zqa;zqtail7 end', 'zqa;zqtail7'],
    ['a comma before a word', 'note password=zqa,zqtail7 end', 'zqa,zqtail7'],
    ['a single quote inside the value', "note password=zqa'zqtail7 end", "zqa'zqtail7"],
    ['a double-quoted value holding an ampersand', 'note password="zqa&zqtail7" end', 'zqa&zqtail7'],
    ['a single-quoted value holding a space', "note PASSWORD='zqa zqtail7' end", 'zqa zqtail7'],
    ['a widened value that ends in a head hands it its quoted value', "note secret=zqa,API_KEY=' zqb zqtail7' end", ' zqb zqtail7'],
  ];
  // [why, input, what B4 (BELT_VERSION 1) printed for it: measured at bd363a76b, and this build prints the same]
  const SAME: Array<[string, string, string]> = [
    ['a plain value', 'note password=zqplain7 end', `note password=${M} end`],
    ['a query string', 'url?a=1&password=zqx&b=2', `url?a=1&password=${M}&b=2`],
    ['a cookie pair', 'password=zqabc; path=/', `password=${M}; path=/`],
    ['a list', 'password=zqabc, user=bob', `password=${M}, user=bob`],
    ['a JSON string', '{"cmd":"password=zqabc"}', `{"cmd":"password=${M}"}`],
    ['a call', "run('password=zqabc')", `run('password=${M}')`],
    ['an empty quoted value', 'TOKEN=""', 'TOKEN=""'],
    ['a double-quoted value', 'note password="zqabc" end', `note password="${M}" end`],
    ['a single-quoted value', "note PASSWORD='zqabc' end", `note PASSWORD='${M}' end`],
    ['an ampersand before NAME=', 'token=zqabc&next=1', `token=${M}&next=1`],
    ['no secret name', 'level=INFO path=/a/b', 'level=INFO path=/a/b'],
    // R11's named residual: the base reading's mark took the tail head's NAME in, so the widened rules read no head there and the
    // value after it prints as at the base (the widening lost to composition). Unchanged, so no hit: the walk leaves the row
    ['a tail head whose NAME the base masked into its value', "note secret=zqvAPI_KEY= 'zqa zqtail7' end", `note secret=${M} '${M} zqtail7' end`],
  ];

  it.each(WIDENED)('widened, %s: the probe counts an owed hit', (_why, text, value) => {
    expect(libRedact.entryIndexText(text, libRedact.makePairIndex([])), 'CONTROL: the index text masks the value whole').not.toContain('zqtail7');
    expect(libRedact.redactField(text, libRedact.makePairIndex([])), 'CONTROL: and so does the field door').not.toContain(value.trim());
    expect(hitsOf(text)).toBeGreaterThan(0);
  });

  it.each(SAME)('not widened, %s: B4\'s output, and no hit', (_why, text, v1) => {
    expect(libRedact.redactField(text, libRedact.makePairIndex([])), 'the value v1 took').toBe(v1);
    expect(hitsOf(text)).toBe(0);
  });

  // the plan's fifth review: a NAME=value glued to an escaped JSON pair. The rev 3.6 door masks the pair's value, and the widened
  // rules then read the NAME's value whole, so the text changes and counts a hit, and the rewritten index text holds no value the B4
  // row masked (measured at bd363a76b: `{"text":"TOKEN=[redacted],"api_key": "[redacted]"}"}`)
  it('an escaped pair glued to a NAME=value: the probe counts a hit, and the rewrite indexes no value B4 masked', () => {
    const text = String.raw`{"text":"TOKEN=zqa,\"api_key\": \"zqescaped7\"}"}`;
    const idx = libRedact.makeProbeIndex([], 0, { beltAll: true });
    expect(libRedact.entryIndexText(text, idx), 'the rewritten index text').toBe(`{"text":"TOKEN=${M} "${M}"}"}`);
    expect(idx.probe.hits).toBeGreaterThan(0);
  });

  // R3 as R11 amends it: the probe's hit IS the comparison. Over f2Cases (the (j3) corpus), these tables and both index doors, a row
  // counts a hit exactly when the composed index text differs from its base reading, the text a BELT_VERSION 1 build wrote
  it('a row counts a hit exactly when the composed index text differs from the rev 3.6 door\'s, through entryIndexText and sidecarIndexText', () => {
    const bare = libRedact.makePairIndex([]);
    const texts = [...f2Cases().map((c) => c.input), ...WIDENED.map(([, t]) => t), ...SAME.map(([, t]) => t)];
    const entry = libRedact.redactDoorReadings(libRedact.entryIndexText)!;
    const sidecar = libRedact.redactDoorReadings(libRedact.sidecarIndexText)!;
    let changed = 0;
    for (const t of texts) {
      const a = libRedact.makeProbeIndex([], 0, { beltAll: true });
      const differs = libRedact.entryIndexText(t, a) !== entry.base(t, bare);
      if (differs) changed += 1;
      expect(a.probe.hits > 0, `entryIndexText: ${JSON.stringify(t)}`).toBe(differs);
      const b = libRedact.makeProbeIndex([], 0, { beltAll: true });
      const bytes = Buffer.from(t);
      expect(libRedact.sidecarIndexText(bytes, b) !== sidecar.base(bytes, bare), `sidecarIndexText: ${JSON.stringify(t)}`).toBe(b.probe.hits > 0);
    }
    expect(changed, 'CONTROL: some rows change, and some do not').toBeGreaterThan(5);
    expect(changed, 'CONTROL: some rows change, and some do not').toBeLessThan(texts.length);
  });

  it('only a re-derivation probe counts: without beltAll the same widened text counts nothing, and a plain index has no probe to count on', () => {
    expect(hitsOf('note password=zqa&zqtail7 end', false)).toBe(0);
    expect(libRedact.entryIndexText('note password=zqa&zqtail7 end', libRedact.makePairIndex([])), 'CONTROL: the widened value is masked whole').not.toContain('zqtail7');
  });

  it('a store a BELT_VERSION 1 build stamped (a first upgrade, or a rollback and forward again) is due, and its walk starts again at cursor 0', () => {
    expect(libRedact.decideBelt({ v: 1, rids: [], gen: null }, [], 0)).toEqual({ due: true, restart: true, next: { v: 1, rids: [], gen: null } });
    expect(libRedact.decideBelt({ v: 1, rids: [], gen: [], gv: 1 }, [], 0).restart, 'a generation a v1 build left open restarts').toBe(true);
    expect(libRedact.rederivePlan(0, 0, 9, { target: 0, cursor: 5, end: 9, belt: true }, true, true)).toEqual({ target: 0, cursor: 0, end: 9, belt: true });
    expect(libRedact.decideBelt({ v: libRedact.BELT_VERSION, rids: [], gen: null }, [], 0).due, 'CONTROL: a store at this version is not due').toBe(false);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms. First list what the filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'D-5746|frozen belt contract' | wc -l)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5746|frozen belt contract')
```

Expected: the list prints 24 (this describe's 23 cases and the frozen-contract case). The run is red, `11 failed | 13 passed`, measured on a copy of `bd363a76b` with Task 1 as written and this task's lib change undone:
- the frozen-contract case fails `expected 1 to be 2`;
- the seven `widened` cases and the escaped-pair case fail `expected 0 to be greater than 0`; their CONTROLs pass, because Task 1 already masks each value;
- the comparison case fails `entryIndexText: "password=ab&cdXQ9": expected false to be true`;
- the rollback case fails `expected { due: false, restart: false, …(1) } to deeply equal { due: true, restart: true, …(1) }`;
- the 12 `not widened` cases and the beltAll case pass. They are CONTROLs, and Task 1 already prints v1's output for each.

- [ ] **Step 4: Write the failing store tests.** Two files.

(a) `server/test/history-ingest.test.ts`. Append at the end of the file:

```ts

// ── W5h-2 Task 2: the BELT_VERSION 2 generation rewrites only the rows the widened class changes (D-5746 (history-belt-v2-value-class-reindex)) ─
// In process, so the re-derivation's own count is read. A store this build indexed has its row for the widened value replanted
// as a BELT_VERSION 1 build indexed it (the value's tail a term of its own), and fts_belt stamped v 1, as every B4 or W5h-1 build
// stamps it: the first tick after an upgrade, or after a rollback and forward again. The stamp is the literal 1, never
// BELT_VERSION - 1, so the mutant that leaves BELT_VERSION at 1 reads a covered store and opens nothing.
describe('W5h-2 Task 2: a store stamped BELT_VERSION 1 re-derives under the widened class and rewrites only the row a widened value changes (D-5746)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const W5 = (s: IxSweep) => s as unknown as { beltWitness(db: DatabaseSync): string };
  const w5Matches = (db: DatabaseSync, q: string): number =>
    (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { n: number }).n;

  it('one row re-indexed: the widened value\'s; the row whose named value v1 already masked whole and the plain row are left as they are', async () => {
    const { sweep: S, store, lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-w5h2-belt-');
    const tail = `zqwt${randomBytes(6).toString('hex')}7`;
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, `zqwide one password=zqa&${tail} end`, 1),
        IX.user(IX.uuidN(2), IX.uuidN(1), 'zqwide two password=zqplain7 end', 2),
        IX.user(IX.uuidN(3), IX.uuidN(2), 'zqwide three plain words', 3),
      ]));
      IX.sweepTwice(box);
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const w = store.openWriter(P.dbFile);
      try {
        expect(w5Matches(w, 'zqwide'), 'CONTROL: the three rows are indexed').toBe(3);
        expect(w5Matches(w, `"${tail}"`), 'CONTROL: this build indexed the value whole').toBe(0);
        const bare = lib.makePairIndex([]);
        const blobs = w.prepare('SELECT blob_id, z, raw_len FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL ORDER BY blob_id').all() as { blob_id: number; z: Uint8Array; raw_len: number }[];
        let planted = 0;
        for (const b of blobs) {
          const t = await S.ftsTextOfBlob(b.z, false, bare, Number(b.raw_len));
          if (t.text === null || !t.text.includes(tail)) continue;
          const now = lib.entryIndexText(t.text, bare);
          const v1 = now.replaceAll(`password=${lib.REDACTED_MARK}`, `password=${lib.REDACTED_MARK}&${tail}`);
          expect(v1, 'CONTROL: the row this build wrote masks the value whole').not.toBe(now);
          w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(b.blob_id);
          w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(b.blob_id, v1);
          planted += 1;
        }
        expect(planted, 'CONTROL: one blob holds the widened value').toBe(1);
        const s0 = lib.parseBeltState((w.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string }).v)!;
        store.setMeta(w, lib.BELT_META, lib.formatBeltState({ v: 1, rids: s0.rids, gen: null, w: W5(S).beltWitness(w) }));
        expect(w5Matches(w, `"${tail}"`), 'CONTROL: the replanted row answers the tail, as a v1 row does').toBe(1);
        const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
        ctx.fts = S.ftsPrepare(w, ctx.nowMs).tables;
        expect(await S.rederiveFts(w, ctx, S.newBudget())).toEqual({ state: 'completed', reindexed: 1 });
        expect(w5Matches(w, `"${tail}"`), 'the tail is no MATCH').toBe(0);
        expect(w5Matches(w, 'zqwide'), 'every row is still indexed').toBe(3);
        expect(lib.parseBeltState((w.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string }).v)?.v).toBe(lib.BELT_VERSION);
        expect(IX.blobsHold(w, tail), 'the store stays lossless').toBe(true);
      } finally { w.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 120_000);
});
```

(b) `server/test/history-maint.test.ts`. First the two import edits. Check each anchor is unique: both `grep -c` commands print 1.

```bash
grep -c "  REDACTED_MARK, redactField, makePairIndex, makeBelt, beltUnits, secretPairs, formatBeltState, BELT_META, backupNameOf,$" server/test/history-maint.test.ts
grep -c "^import { backupOp, ftsOwedPlans, idsFromFiles, measureSpoolStanding, openFtsRebuild, pruneApplyOp, recordBeltDueIfUncovered } from '../../ccd/history/sweep.mjs';" server/test/history-maint.test.ts
```

Replace the line

```ts
  REDACTED_MARK, redactField, makePairIndex, makeBelt, beltUnits, secretPairs, formatBeltState, BELT_META, backupNameOf,
```

with

```ts
  REDACTED_MARK, redactField, makePairIndex, makeBelt, beltUnits, secretPairs, formatBeltState, BELT_META, backupNameOf, entryIndexText,
```

and the line

```ts
import { backupOp, ftsOwedPlans, idsFromFiles, measureSpoolStanding, openFtsRebuild, pruneApplyOp, recordBeltDueIfUncovered } from '../../ccd/history/sweep.mjs';
```

with

```ts
import { backupOp, beltWitness, ftsOwedPlans, ftsTextOfBlob, idsFromFiles, measureSpoolStanding, openFtsRebuild, pruneApplyOp, recordBeltDueIfUncovered } from '../../ccd/history/sweep.mjs';
```

A task that lands earlier in this PR may have changed either import line. If so, add the three names to the line as it stands and keep the rest.

Then append at the end of the file:

```ts

// ── W5h-2 Task 2: stored text is re-cleaned under the widened class, as a sweep phase (D-5746 (history-belt-v2-value-class-reindex)) ─
// End to end, through the real scheduled sweep on a fixture HOME. The store is left as a BELT_VERSION 1 build (B4, W5h-1) leaves
// it: the blobs_fts row of the searchable request that holds `password=zqa&<tail>` indexes the tail as a term of its own, one
// leaf's gist and its nodes_fts row hold `password=[redacted]&<tail>`, and fts_belt is stamped v 1 with the store's own witness,
// taken in a transaction of its own after the index writes committed (a witness read inside the transaction that wrote blobs_fts
// may be behind, spec §6.2 "Witness timing", and a moved witness would open a generation whatever the version). One more row,
// holding no named value, carries a sentinel term the re-derivation would never write: the generation must leave that row alone.
describe('W5h-2 Task 2: the scheduled ticks re-clean a store a BELT_VERSION 1 build indexed (D-5746)', () => {
  skipOnDarwin();

  it('the ticks rewrite the blobs_fts rows and the gist holding a widened value and stamp BELT_VERSION; a row holding none keeps its planted body', async (ctx) => {
    const tail = `zqwt${randomBytes(6).toString('hex')}7`;
    const box = makeHistoryBox('ccrc-hist-w5h2-belt-', { role: 'fleet', shim: true });
    // A searchable row (summaries are not indexed) holding the widened value: segment 0's first request.
    const rows = compactionSequence({ n: 2, trigger: 'manual' }).rows
      .map((r) => JSON.parse(JSON.stringify(r).replaceAll('Segment 0 request 0.', `Segment 0 request 0 password=zqa&${tail} end.`)) as typeof r);
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows });
    expect(runSweep(box).code).toBe(0);
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();          // a Node without FTS5 has no index to re-derive
    const leaf = maintQ<{ node_id: string; rid: number }>(box, 'SELECT node_id, rowid AS rid FROM nodes WHERE depth = 0 ORDER BY rowid LIMIT 1')[0];
    expect(leaf, 'CONTROL: the fixture derived a leaf').toBeDefined();
    const plantedGist = `Rotate the service password=${REDACTED_MARK}&${tail} for segment 0.`;
    const bare = makePairIndex([]);
    const db = new DatabaseSync(dbFile(box));
    let planted = 0;
    try {
      db.exec('BEGIN IMMEDIATE');
      const blobs = db.prepare('SELECT blob_id, z, raw_len, EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = blobs.blob_id) AS is_sidecar FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL ORDER BY blob_id').all() as Array<{ blob_id: number; z: Uint8Array; raw_len: number; is_sidecar: number }>;
      let sentinel = false;
      for (const b of blobs) {
        const t = await ftsTextOfBlob(b.z, b.is_sidecar === 1, bare, Number(b.raw_len));
        if (t.text === null) continue;
        const now = entryIndexText(t.text, bare);
        let body: string | null = null;
        if (t.text.includes(tail)) {
          body = now.replaceAll(`password=${REDACTED_MARK}`, `password=${REDACTED_MARK}&${tail}`);
          expect(body, 'CONTROL: the row this build wrote masks the value whole').not.toBe(now);
          planted += 1;
        } else if (!sentinel && !t.text.includes('=')) {
          body = `${now} zqkeep7`;
          sentinel = true;
        }
        if (body === null) continue;
        db.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(b.blob_id);
        db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(b.blob_id, body);
      }
      expect(sentinel, 'CONTROL: a row with no named value took the sentinel').toBe(true);
      const row = db.prepare('SELECT topics, refs FROM nodes_fts WHERE rowid = ?').get(leaf!.rid) as { topics: string; refs: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(plantedGist, leaf!.node_id);
      db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(leaf!.rid);
      db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(leaf!.rid, plantedGist, row.topics, row.refs);
      db.exec('COMMIT');
      db.exec('BEGIN IMMEDIATE');
      const s0 = JSON.parse(getMeta(db, BELT_META)!) as { rids: number[] };
      setMeta(db, BELT_META, formatBeltState({ v: 1, rids: s0.rids, gen: null, w: beltWitness(db) }));
      db.exec('COMMIT');
    } finally { db.close(); }
    expect(planted, 'CONTROL: one indexed row holds the widened value').toBe(1);
    const tailQ = `"${tail}"`;
    const nodesMatch = (): number => maintQ<{ n: number }>(box, 'SELECT count(*) AS n FROM nodes_fts WHERE nodes_fts MATCH ?', tailQ)[0]!.n;
    const belt = (): { v: number; gen: number[] | null } => JSON.parse(maintMeta(box, BELT_META)!) as { v: number; gen: number[] | null };
    const nodesBeltDone = (): boolean =>
      maintQ<{ c: number | null }>(box, "SELECT completed_ms AS c FROM derivation_state WHERE step = 'nodes-belt' AND version = 1")[0]?.c != null;
    expect(maintMatch(box, tailQ), 'CONTROL: the planted rows answer the tail, as v1 rows do').toBe(planted);
    expect(nodesMatch(), 'CONTROL: and so does the planted gist\'s nodes_fts row').toBe(1);
    expect(maintMatch(box, 'zqkeep7'), 'CONTROL: the sentinel is indexed').toBe(1);
    expect(belt().v, 'CONTROL: stamped as a BELT_VERSION 1 build stamps it').toBe(1);
    for (let k = 0; k < 6 && !(belt().v === BELT_VERSION && belt().gen === null && nodesBeltDone()); k += 1) expect(runSweep(box).code).toBe(0);
    expect(belt().v, 'the generation completed under this version').toBe(BELT_VERSION);
    expect(maintMatch(box, tailQ), 'no blobs_fts row answers the tail').toBe(0);
    expect(maintMatch(box, 'zqkeep7'), 'a row with no widened value is not rewritten').toBe(1);
    const gist = maintQ<{ gist: string }>(box, 'SELECT gist FROM nodes WHERE node_id = ?', leaf!.node_id)[0]!.gist;
    expect(gist, 'the stored gist is re-cleaned from its own text').toBe(`Rotate the service password=${REDACTED_MARK} for segment 0.`);
    expect(nodesMatch(), 'and its nodes_fts row with it').toBe(0);
  }, HEAVY);
});
```

Summaries are stored with `fts_indexed = 0` (measured), which is why the widened value rides segment 0's first request, a searchable row.

- [ ] **Step 5: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5746')
```

Expected: red, with `1 failed` in each and the rest skipped, measured on a copy of `bd363a76b` with Task 1 as written:
- `history-ingest`: `expected { state: 'idle', reindexed: +0 } to deeply equal { state: 'completed', reindexed: 1 }`. The store reads covered, so no generation opens.
- `history-maint`: `no blobs_fts row answers the tail: expected 1 to be +0`. Every CONTROL before the ticks passes, which proves the plant is a faithful v1 row and the witness was not moved.

- [ ] **Step 6: Write the lib change.** In `ccd/history/lib.mjs`:

(a) In `composeDoor`, which Task 1 wrote, replace the one line

```js
  return r.v2(base, idx);
```

with

```js
  const out = r.v2(base, idx);
  // D-5746: under a re-derivation probe, a text this build writes otherwise than its rev 3.6 door wrote it is an owed hit
  if (out !== base && typeof out === 'string' && idx !== null) {
    const hit = beltHit(idx);
    if (hit !== null) hit();
  }
  return out;
```

(b) Replace the `BELT_VERSION` docstring's last line and the declaration,

```js
 *  to layer 4, to the glue windows, to beltWidth, to beltFold or to the seed rule. */
export const BELT_VERSION = 1;
```

with

```js
 *  to layer 4, to the glue windows, to beltWidth, to beltFold or to the seed rule, and with any change to a layer-2
 *  field-form rule that can change an index text (D-5746 (history-belt-v2-value-class-reindex)).
 *  2 (W5h-2): the named value class widened in its field form, which every door reads over its rev 3.6 door's output
 *  (W5h-2 Task 1, D-5745, R11). Under a re-derivation probe composeDoor counts an owed hit when that reading changes the
 *  rev 3.6 door's text, which is the text a build at 1 stored, so the generation this bump opens rewrites exactly the rows
 *  whose text changes, and, as every belt generation does, rows with a pair above the mark or a layer-4 or glue-window
 *  hit; the node belt step re-redacts every stored node field from its own text. A rollback to a build at 1 reads 2 as
 *  due, walks once and stamps 1; moving forward reads 1 as due and walks again: safe, since a walk rewrites only rows
 *  whose probe counted a hit, at the cost of a second walk. */
export const BELT_VERSION = 2;
```

Check: `grep -c '^export const BELT_VERSION = ' ccd/history/lib.mjs` prints 1, and `grep -c '^  const out = r.v2(base, idx);$' ccd/history/lib.mjs` prints 1.

- [ ] **Step 7: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5746|frozen belt contract')
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5746')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected (measured on a copy of `bd363a76b` with Tasks 1–3):
- `history-lib`: `24 passed`;
- `history-ingest`: `1 passed`;
- `history-maint`: `1 passed`;
- tsc: no line naming `history-lib.test.ts`, `history-ingest.test.ts` or `history-maint.test.ts`. A line that names only `agent/src/` or a module that is not installed (`ws`, `yaml`) comes from the worktree's install, not from this task.

- [ ] **Step 8: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs its filters, shows red and restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h2/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"

# M1: the comparison's hit dropped. The generation still opens (the version moved) and the nodes still heal, but no blob row
# whose text changes is rewritten.
mut ccd/history/lib.mjs "  if (out !== base && typeof out === 'string' && idx !== null) {
    const hit = beltHit(idx);
    if (hit !== null) hit();
  }
" ""
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5746')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): maint `no blobs_fts row answers the tail: expected 1 to be +0`; ingest
# `expected { state: 'completed', reindexed: +0 } to deeply equal { state: 'completed', reindexed: 1 }`;
# lib `9 failed | 14 passed`: the seven widened rows and the escaped-pair row, `expected 0 to be greater than 0`, and the comparison
# case, `entryIndexText: "password=ab&cdXQ9": expected false to be true`.

# M2: BELT_VERSION left at 1. No generation opens on a store stamped 1.
mut ccd/history/lib.mjs "export const BELT_VERSION = 2;" "export const BELT_VERSION = 1;"
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5746|frozen belt contract')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): maint `no blobs_fts row answers the tail: expected 1 to be +0`; ingest
# `expected { state: 'idle', reindexed: +0 } to deeply equal { state: 'completed', reindexed: 1 }`;
# lib `2 failed | 22 passed`: `expected 1 to be 2` and the rollback case's deep equality.

# M3: every composed door counts a hit, its text changed or not (a costlier walk that rewrites rows v1 already wrote right).
mut ccd/history/lib.mjs "  if (out !== base && typeof out === 'string' && idx !== null) {" "  if (typeof out === 'string' && idx !== null) {"
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5746')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): ingest `expected { state: 'completed', reindexed: 3 } to deeply equal { state: 'completed', reindexed: 1 }`;
# lib `13 failed | 10 passed`: the 12 `not widened` rows, `expected 1 to be +0`, and the comparison case.

# M4 (a CONTROL of the CONTROL, not this task's guard): rederiveFts' existing hit test forced, so every row is rewritten.
mut ccd/history/sweep.mjs "          if (idx.probe.hits > 0) { group.push(" "          if (true) { group.push("
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5746')
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'D-5746')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured): maint `a row with no widened value is not rewritten: expected +0 to be 1`; ingest `reindexed: 3`.

git diff --stat -- ccd/history   # only lib.mjs
git diff -- ccd/history | grep -c '^@@'   # 2: composeDoor and BELT_VERSION (against Task 1's commit)
```

Then run Step 7's commands once more: green.

- [ ] **Step 9: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Expected: green. Measured on a copy of `bd363a76b` with Tasks 1–3 applied (Task 3's cases included where noted):
- `history-ingest`: `164 passed`, the base's 163 plus this task's 1 (about 81 s);
- `history-maint`: `126 passed`, the base's 118, this task's 1 and Task 3's 7 (about 2 min); `119` with Tasks 1 and 2 alone, predicted;
- `history-recover`: `139 passed` (its belt pins read `BELT_VERSION` by name);
- `history-derive`: `48 passed`;
- `single-definition -t 'ccrc history'`: `93 passed` with Task 3's VOCABS entry (`92` without it);
- `history-lib`: `1124 passed` with Tasks 1–3 (1083, Task 1's 6, this task's 23 and Task 3's 12; about 107 s); `1112` with Tasks 1 and 2, the count the filter runs listed.

- [ ] **Step 10: Amend the spec, §6.2.** In `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`:

(a) In the bullet `**The belt's state.**`, replace the sentence

```markdown
Layer 4 and the glue windows read the values the tick loaded and code that `BELT_VERSION` tags, which the owed-pair argument of the re-derivation does not cover.
```

with

```markdown
Layer 4 and the glue windows read the values the tick loaded and code that `BELT_VERSION` tags, which the owed-pair argument of the re-derivation does not cover. `BELT_VERSION` also tags layer 2's field-form rules (§8.3): a change to one that can change an index text bumps it, as version 2 does for the widened named value class (D-5746).
```

(b) Directly above the line that begins `  - **When a belt generation opens, and when it restarts.**`, insert:

```markdown
  - **Which rows a belt generation rewrites** (D-5746). The re-derivation rewrites a row only when its probe counts an owed hit: a pair above the mark, a layer-4 or glue-window hit, and since `BELT_VERSION` 2 an index text that this build writes otherwise than version 1 wrote it. Every output path reads the widened rules over the version-1 path's own output (§8.3), and under a probe a path counts a hit exactly when that second reading changes the text. With no hit the text is the version-1 path's, which is the row a version-1 build stored, so the walk rewrites exactly the rows whose text changes, plus the rows every belt generation rewrites (a pair above the mark, a layer-4 or glue-window hit), and a rewrite never un-masks a row: the new text is the stored text read once more, and that reading only masks. It can add a term: where the wider reading finds a value only at a JSON-decoded level or with the text's escape sequences removed, the new text is that reading, so a value the stored row held only escaped, or split by a sequence, is indexed whole (§8.3's residuals). A later generation finds those rows differing from their version-1 reading again and rewrites them with the same text. Stored node fields heal without their source text: the node belt step re-redacts each stored gist, topic and ref, and re-redacting a version-1 output gives what redacting the raw text gives (measured on every probe input of the wave's scope). A rollback to a version-1 build reads version 2 as due, walks once and stamps 1; moving forward reads 1 as due and walks again, which is safe and costs a second walk. Until the walk completes, `grep` still answers a term that only an unrewritten row holds; display masks it at read time.
```

Check: `grep -c 'D-5746' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` prints 2. Then run `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')` again: green.

- [ ] **Step 11: Commit.**

```bash
git add ccd/history/lib.mjs server/test/history-lib.test.ts server/test/history-ingest.test.ts server/test/history-maint.test.ts \
  docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git commit -m "feat(history): BELT_VERSION 2 re-cleans stored text, rewriting exactly the rows whose composed index text differs from their rev 3.6 reading (W5h-2 Task 2, D-5746)"
```

**Residuals, named (Task 2):**
- **The run budget, shared with 5h-1's bounded bind check.** The v2 generation spends each tick's re-derivation slice (`REDERIVE_SLICE_MS` 20 s, `REDERIVE_SLICE_BYTES` 128 MiB) until it completes, and the slice is charged to the run budget too. 5h-1's check after a bind runs last in the tick, in `exportStep`, and charges the same run budget. So while the generation runs, an owed bind check may stop on `budget`. Doctor then shows 5h-1's WARN `export-marks-unchecked` with the word `budget`, which never escalates. It clears once the walk completes. No code here.
- **Grep before the walk reaches a row.** Until then a row keeps its v1 terms, so `grep` can still answer a tail term in it. Display, the relay and the `--regex` child mask it at read time already.
- **A rollback pays twice.** A B4 or 5h-1 build reads `fts_belt` v 2 as due, walks the whole index once under v1 and stamps 1, and rows it ingests carry v1 tails. Moving forward reads 1 as due and walks again, rewriting only the rows its probe counts.
- **Later generations rewrite the changed rows again** with the text they already hold (an extra rewrite, no change of text), as a layer-4 hit already does.
- **One `redact_belt_generations` event per store.** The bump opens the generation from a state whose `v` is not 0, so `rederiveFts` counts it as a belt generation (`BELT_COUNTERS.generations`). No doctor rule reads that counter.
- **Phrase search during the walk.** While any generation is open, the same-tick phrase path searches only the values the tick itself recorded (`phraseValues`). This is unchanged, and the walk covers the rest.

**For the PR body (Task 2):** the re-clean is automatic on every node. Its cost is an ESTIMATE from scope b2-redaction and this task's measurement, not a measurement of a live store:
- Re-deriving ran at about 2.6 MiB/s of compressed bytes (7.4 MiB/s of text) at the scope, measured on a 23.5 MiB compressed fixture. Composition reads each row twice: `entryIndexText` measured 1.9 to 2.0 times the base's time on this repository's code and docs.
- On a store of about 2 GB the scope estimated roughly 4–13 min of CPU, spread over about 8–40 two-minute ticks (0.3–1.3 h of wall time) inside the existing re-derivation slice. With the redaction doubled, that is at most about 8–26 min of CPU over at most about twice the ticks, predicted: the redaction's share of the re-derivation was not measured. The live store's indexed share was not measured either.
- The rows whose index text changes are rewritten: 0.69% of 29,495 4-KiB rows of this repository's code and docs, measured with no secret pair loaded (the scope measured 0.67% of 27,280 rows holding a widened value). Every row with a pair above the mark or a layer-4 or glue-window hit is rewritten too, as in every belt generation, whether or not its text changes; that share of a live store was not measured, so the 0.69% is a floor, not the generation's size. A forced rewrite of every row would grow the index about 1.8x until merged, which is why it was not chosen.
- Grep stays available throughout. No operator act is needed; `doctor --repair` is the manual alternative and is not the path.

### Task 3: the relay masks a secret split across lines

The operator door runs the history shim as a child and relays its two streams (D-5022). Stdout is relayed line by line, and each line is redacted alone: runOpVerb's emit runs `redactFinalLines(line, idx)` on one line at a time. So a JSON value on the line after its key prints in clear, and of a PEM block only the BEGIN line is masked; the body and the END line print. Stderr is held and redacted as one text, but once the hold passes `ERR_HOLD_CAP` (1 MiB) it spills at its last line break, and a shape split across that seam is read in two pieces. D-5022 recorded both as residuals. The ledger owes them as "Owed from B2" item 2 (scope b2-redaction, item B2-2). Measured at `e4936efab`: `{"password":` followed by `  "hunter2xyz"}` prints the value, and a PEM body after its BEGIN line prints.

This task implements ruling R4:
- **The window.** Each SOURCE stream keeps the last `RELAY_LOOKBEHIND_BYTES` (16384) bytes of the RAW text it has written. That constant is declared once, in `lib.mjs`.
- **The read.** Each new text is redacted together with its stream's window, by lib's new `redactAfter(lookBehind, text, idx)`.
- **Batches.** Stdout goes out one batch per data chunk instead of one line at a time.
- **Stderr.** The held text and the spill go through the same window, so a shape split across the 1 MiB seam is masked when its head lies within the window.
- **Keyed by source.** The windows are keyed by the stream the text came from, never by where the CLI writes it: under `--json` both streams are written to stderr.
- **The standalone pass.** The batch is read alone FIRST, and the context reading runs over that output and keeps its marks, so what is written is never less masked than `redactFinalLines` of the batch alone (R4, as amended by the coordinator on this task's measurement; Choices below).
- **The per-line baseline** (R4, as amended by the coordinator on review finding 11, its fallback's form ruled by the coordinator: the line-aligned union, accepted 2026-10-19). The relay before this wave redacted stdout one line at a time, so the relay is measured against that per-line reading: every piece it writes is text that reading prints, on a line the window's line breaks allow, so a value a line alone masks is written only where another line of the same batch, read alone, prints the same characters (the union's residual, below). Batching alone broke that: one chunk holding `{"token":` and, on the next line, `"password": "V"}` printed V, because the JSON-form rule read `"password"` as token's value (review finding 11, measured by the plan's review on a copy of `bd363a76b` with this task as first written, human and `--json`). The union closes it: the next pair is written as one mark from its key on (`"[redacted]`), where the per-line reading prints the key and masks the value. This task pins the guarantee with that input, in one batch and in a stand-in shim's one chunk, and with a property case over f2Cases and every two- and three-line batch of JSON, `NAME:`, `NAME=`, colon-led, PEM and coloured fragments (a NAME or a value a colour sequence splits, and a coloured line with nothing to mask), a value counting as printed when the output holds it with or without the sequences inside it.
- **The composed doors** (R11). The window's reading and the per-line reading are this build's `redactFinalLines`, which reads the widened rules only over the rev 3.6 door's output (Task 1). So the per-line reading masks every value the base's per-line relay masked, by construction, and the guarantee above holds against the base's per-line relay itself (measured: 200,000 random batches, 0 printed). A value is masked when no reading of the output holds it, its escape sequences removed or not: a value the base's per-line relay printed split by a colour sequence can print whole (Task 1's joined-reading residual).
- **The union** (R4's fallback, taken at the plan's second review, aligned by line at its third, and accepted by the coordinator on 2026-10-19). Some batches no rule change can close: one batch holding `zqx26 <BEGIN line>` and `TOKEN=<BEGIN line>abc<END line>V` prints V, because the first BEGIN line's mark runs to the END and takes `TOKEN=` in, where that line read alone masks V. No rule change closes it, and the batch relay never ships with a known per-line regression, so `redactAfter` writes the window's reading with a mark over every piece of it that the batch read one line at a time does not print where that piece can lie (`relayUnion`). Every piece written is text the per-line reading also prints, on a line the window's line breaks allow; every mark the window's reading wrote stays. As first written, the union looked for each piece anywhere later in the per-line reading, so a value its own line masks was written where the same characters occur on a later line, and the lines up to that later occurrence were written as marks; the plan's third review aligned it by line (Choices below).

The departure is **D-5747** (`history-relay-lookbehind-window`), which amends D-5022's final shape.

This task runs after Task 1: its relay reads Task 1's composed `redactFinalLines` (R4: the window's reading uses the composed doors), and its pins and figures were measured with it. It is independent of Task 2. Its other pins use JSON and PEM shapes, whose masking does not depend on the named rule's value class, which Task 1 widens. Wave 5h-1 does not touch any region this task edits: its `lib.mjs` edits are `HEALTH_WORDS`, `deriveHealth`, `HEALTH_REMEDIES`, `remedyFor` and sections appended at the end of the file, and its `cli.mjs` edits are `readStoreExtras`, `readHealthExtras` and `healthInputsOf`. Every hunk here stands apart from those, and the worker re-anchors each by its quoted content on `main` after 5h-1.

**Files:** (line numbers measured at `bd363a76b`; re-anchor by the quoted content)
- Modify: `ccd/history/lib.mjs`. One section directly after `redactFinalLines`, which since Task 1 ends `  return composeDoor(DOOR_READINGS.redactFinalLines, [text, idx], idx);` and `}` (`:2685-2687` at the base), and before the doc comment `/** A frame tag of the recalled-text envelope` (`:2689`). lib.mjs imports only `node:crypto`; `Buffer` is the global it already uses (`:664`, `:718`).
- Modify: `ccd/history/lib.d.mts`. Two lines directly after `export function redactFinalLines(text: string, idx: PairIndex): string;` (`:311`).
- Modify: `ccd/history/cli.mjs`:
  - the operator door's header comment, item 4 (`:1359-1364`), from `//      and stderr are piped. stdout is relayed line by line as it arrives` to `//      line, the sweep's` … `is held back for`;
  - `ERR_HOLD_CAP`'s doc comment (`:1414-1418`);
  - `opRelay`'s doc comment, its first four lines (`:1424-1427`);
  - `opRelay`'s `onOut` (`:1493-1499`);
  - `runOpVerb`'s doc comment (`:1558-1560`) and its last line (`:1585`), `  return opRelay(P, map.op, map.opArgs, (line, toStderr) => emit(redactFinalLines(line, idx), toStderr));`;
  - `operatorMain`'s doc comment, its last two lines (`:1611-1612`).
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, §8.4 "Verbs", the bullet "Every writing form runs …" (`:1742`), one sentence in place. Wave 5h-1's Task 7 edits §8.4's "Carry before the verb" bullet (`:1776`), which is a separate hunk.
- Test: `server/test/history-lib.test.ts`. One describe appended at the end of the file (after `:8671`, and after any describe an earlier task appended), 12 cases. It uses the module-scope `libRedact` import (`:35`) and `f2Cases` (`:15`).
- Test: `server/test/history-maint.test.ts`. One describe appended at the end of the file (after `:2837`). It uses the module-scope `boundBox`, `op` and `HEAVY` (`:37-52`), the imports `fs`, `path`, `randomBytes`, `REDACTED_MARK`, `stubShim`, `rawShim`, `startCli` and the type `HistoryBox` (`:12-30`), and adds no import.
- Test: `server/test/history-cli.test.ts`. In H-32 ("no stderr write in cli.mjs prints an error message except through errLine, which redacts"), the source pin `    expect(src).toContain('emit(redactFinalLines(line, idx), toStderr)');` (`:407`) is replaced. That pin names the per-line emit this task removes. Measured: with the new relay, H-32 goes red on it and nothing else. The stderr-write count (9) and the allow-list stay as they are, because this task adds no `process.stderr.write`.
- Test: `server/test/single-definition.test.ts`. In the O14 describe's `VOCABS` (`:5226`), one entry directly after the line `    'BELT_COUNTERS', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META',` (`:5236`). It is not added after the list's last line, `'EXPORT_MARK_BACKOFF_MAX_MS', 'EXPORT_DUE_OLDEST_UNMEASURED'] as const;`, because wave 5h-1's Tasks 1 and 3 replace that line.
- Not edited:
  - `server/test/fixtures/history/f2Cases.ts` (Task 1's);
  - `ccd/history/sweep.mjs` (the relay is CLI-only);
  - `history-maint.test.ts`'s cap-bound cases and their comment (`:662-733`). The spill's byte arithmetic is unchanged and marks change no byte of non-secret text, so those pins stay green as they are;
  - D-5022's entry in the B2 plan. It is one line, and Task 6 edits it after this task (B2's item 5 (a): D-5022's `(1 << 20) - 1` claim, its "never on timing", and its residual closed by this task's window), worded to what this relay does. D-5747's entry records the amendment.

**Interfaces:**
- Consumes (Task 1): the composed `redactFinalLines` (R11), whose every reading reads the widened rules over the rev 3.6 door's output.
- Consumes (base):
  - `lib.mjs`: `redactFinalLines(text, idx)`, `REDACTED_MARK`, `makePairIndex`;
  - `cli.mjs`: `opRelay(P, op, opArgs, emit)`, whose `emit(text, toStderr)` takes the shim's stdout text (`false`) or its held stderr text (`true`) without the last line break; `runOpVerb`'s `idx` (relayIndexOf's index);
  - `history-maint.test.ts`'s module-scope helpers and `historyHelpers.ts`'s `stubShim`, `rawShim` and `startCli` (`peek()`, `done`). Fixture HOMEs only.
- Produces:
  - `lib.mjs` and `lib.d.mts`:
    - `export const RELAY_LOOKBEHIND_BYTES = 16384`, typed `export const RELAY_LOOKBEHIND_BYTES: 16384;`;
    - `export function redactAfter(lookBehind: string, text: string, idx: PairIndex): { emit: string; keep: string }`. `emit` is the redacted text to write for `text`: the window's reading unioned with the per-line reading. `keep` is the next look-behind: RAW text of at most `RELAY_LOOKBEHIND_BYTES` UTF-8 bytes;
    - the module-private `relayKeep(raw)`, `relayRead(lookBehind, text, idx)` (the window's reading, `{ emit, keep }`) and `relayUnion(read, perLine)` (R4's fallback).
  - `cli.mjs`:
    - `opRelay`'s `emit(text, false)` may now carry several stdout lines, one data chunk's complete lines. The held-last-line rule for `decideRelay` is unchanged;
    - `runOpVerb`'s emitter keeps `behind = { out: '', err: '' }`, keyed by the second argument, which names the SOURCE stream. Every ending (`onClose`, `fail()`, the signal handlers) writes through that one callback, so it writes through the window.
  - No wire, envelope, exit code, meta key, schema or env change.

**Spec:** §8.4's "Every writing form runs …" bullet (`:1742`), amended in this task's Step 11. §9.8's "redacted on every output" is the rule this task serves. Ruling R4, as amended by the coordinator on this task's measurement and on review finding 11, with its fallback taken at the plan's second review, aligned by line at its third and accepted by the coordinator (2026-10-19); R11 (the composed doors). The departure is D-5747, which amends D-5022; its per-line baseline rests on the union.

**Choices this task makes:**
- **The standalone pass runs first, not last.** R4 as first written asked for "a final standalone pass" so that the output is never less masked than `redactFinalLines` of the batch alone. Run last, over the context reading's output, it does not give that.
  - The case first measured, at `bd363a76b`: the look-behind is `{"token":` and the batch is `"password": "hunter2xyz"}`. The context reading took `"password"` as token's value and resumed past it, writing `"[redacted]": "hunter2xyz"}`, and a pass over that sees no secret name left. With the standalone pass first, the batch's own value is masked before the context reading takes `"password"`: `"[redacted]": "[redacted]"}` (Step 1's finding-11 case, measured).
  - The case that still does, measured with Tasks 1–3 applied: the look-behind is `zqx26 <BEGIN line>` and the batch is `TOKEN=<BEGIN line>abc<END line>hunter2xyz`. Read alone, the field pass masks the value and the PEM block, and the final pass then reads `TOKEN=[redacted]hunter2xyz` and masks the glued tail: `TOKEN=[redacted]`. Read together, the look-behind's PEM block runs to the batch's END, its mark takes `TOKEN=` in, and the final pass sees no NAME before `hunter2xyz`, so the context reading alone writes `[redacted]hunter2xyz`. A seeded search of 200,000 random look-behind and batch pairs found 2 of this shape among the 49,572 the batch masks alone; none with the standalone pass first. Step 1 pins it; M1 was red on it alone before the union (the last sub-bullet here).
  - So `relayRead`, the window's reading inside `redactAfter`, redacts the batch alone FIRST, and the context reading runs over that output. In it a mark only stays or widens, so what is written holds every mark the batch earns alone.
  - Measured over 330 look-behind and batch pairs of JSON, named, header, query, PEM and shape fragments: none was less masked than the batch read alone. The coordinator amended R4 on this measurement (the Decisions table's R4 row): R4's purpose holds, its word "final" does not. D-5747's entry records the amendment.
  - With the union in place, the standalone pass's measured case is also covered by the per-line reading (that batch is one line), so dropping the standalone pass alone (M1's first replacement without its second) is green on it, and a search at the plan's second review found no input that separates it (945,000 planted values, a look-behind line and three batch lines of 27 fragments, counting only values the batch read alone masks). The standalone pass stays, as R4 orders, for a value only the batch read alone masks; Step 10's M1, which also drops the union, is red.
- **The per-line baseline, as first measured** (R4, as amended on review finding 11). This plan first closed finding 11 with a JSON-form key rule, which the coordinator withdrew with R11 (R10). Its measurements found the shape no rule closes: with a value glued after an END on a NAME's line among the fragments (`TOKEN=<BEGIN line>abc<END line>V`), one batch prints V, because a BEGIN line's mark runs to the next line's END and takes its NAME in. Chaining text passes is wrong, as the plan's first review found (the per-line pass run first loses the in-batch PEM body, and run last loses the JSON pair), and a union of spans over the original text needs a reading of `redactFinalLines` that answers spans, which it does not (it composes passes that answer text).
- **The fallback is taken (R4; the plan's second review), and the coordinator accepted its line-aligned form (2026-10-19).** `relayUnion` splits the window's reading at its marks and line breaks and looks for each piece in the per-line reading, on the lines it can lie on; a piece found is written, a piece not found becomes a mark. Every piece written is text the per-line reading also writes, so the union writes no string the per-line relay did not; every mark the window's reading wrote stays, so it is never less masked than that reading. It also closes finding 11 without a rule: the next pair, which the window's reading takes as the key's value, is written as one mark from its key on. Measured on a copy of `bd363a76b` with Tasks 1–3 as now written (R11's composed doors, no key rule):
  - Step 1's property case (34 fragments plus the measured regressions, 47,939 values a line alone masks, read as one batch and after its first line, with the check that the look-behind is never written again): 0 violations; with the union dropped (M15), 1,720. Before the plan's sixth review added its four coloured fragments: 30 fragments, 35,091 values, 1,512 with the union dropped;
  - a seeded search of 200,000 random batches of 2 to 5 lines of 37 fragments (JSON keys, pairs and colon-led lines, `NAME=`, `NAME: `, quoted, unclosed and glued values, an escaped JSON pair after a `NAME=value`, Bearer, PEM lines and a value glued after an END), read as one batch and after a look-behind of their first line: of 321,747 values that `bd363a76b`'s own per-line relay masks, none was written;
  - the relay's maint neighbours (`D-5022|O54|the relay redaction|D-5747`): `42 passed`;
  - cost, with the composed doors (each reading about two passes), on one box under a load average of about 15: 10,000 lines of about 100 B in 17 chunks, 407 to 426 ms (226 to 259 ms with one reading of each door, the plan's figure before R11 238 to 256 ms; 93 to 122 ms for the base's per-line relay); a dense secret stream (a named value and a JSON pair on every line), 523 to 579 ms (257 to 302 ms with one reading); 30,000 two-byte lines in one chunk, 355 to 375 ms (187 to 196 ms); the 1 MiB repeated three-line shape, 590 to 711 ms (403 to 456 ms); one windowed redaction per line (a slow producer), about 2.5 ms a line (about 1.3 ms with one reading).
- **The union is aligned by line (the plan's third review).** As first written, `relayUnion` looked for each piece with `perLine.indexOf(piece, at)`, anywhere after the last piece found. Three faults followed, each measured on a copy of `bd363a76b` with Tasks 1 and 3:
  - a value its own line masks was written where the same characters occur later in the batch: `zqx26 <BEGIN line>`, `TOKEN=<BEGIN line>abc<END line>hunter2xyz` and `hunter2xyzzy.log` wrote `zqx26 [redacted]hunter2xyz` and then `[redacted]`, where the per-line reading writes `TOKEN=[redacted]` and `hunter2xyzzy.log`;
  - the lines up to such a later occurrence were all written as marks: with `TOKEN=<BEGIN line>abc<END line>done` followed by `file a.md ok`, `file b.md ok`, `file c.md ok` and `all done`, every one of those four lines became a mark (on stderr, up to the whole 1 MiB hold);
  - it was quadratic: a piece not found cost a scan of the rest of the batch, and the mark test read the end of an output string it had just grown. A repeated three-line shape took 6,966 ms on 1 MiB (redactFinalLines alone 39 ms), and 10,000 dense lines took 2,482 ms.

  Every line break the window's reading keeps is one of the batch's, in order (a mark only takes text in), and the per-line reading keeps them all, one line per batch line. So `relayUnion` now gives each piece the lines it can lie on: exactly the line the breaks since the last piece written count to, when no mark stands between them, and otherwise the lines from there to the last one the breaks after it allow. On such a line a piece that starts its line in the window's reading must start the per-line line, one that ends its line must end it, and one between two marks is looked for after the last piece written. The lines are tried in order, at most `RELAY_LOOKBEHIND_BYTES` characters of them past the first, then the last line allowed (one mark taking in every break: a long PEM body). The output is an array joined once. Measured at the plan's third review with Tasks 1 and 3 as then written: Step 1's cases green, the property case 0 violations; the three inputs above write `zqx26 [redacted]` and `hunter2xyzzy.log`, and every plain line; 1 MiB of the repeated shape in 257 ms; 8 MiB in which every third line's value is not where the window's reading puts it, 3.5 s (the first union, even with its output joined once, 64 s, and this one without its reach bound 92 s: Step 1 pins it under a 30 s ceiling, M19); 10,000 lines in 17 chunks 238 to 256 ms (the first union 208 ms), 30,000 two-byte lines 173 to 185 ms (188 ms), the 10,000 dense lines 184 to 253 ms (2,482 ms), all on one box; a seeded search of 200,000 random batches of 2 to 5 lines of 31 fragments, a quarter of them carrying one of three repeated values, printed no value its own line masks except on an output line the per-line reading writes as it is, and wrote 1 more of its 255,988 plain lines other than whole than the first union did. The relay's maint neighbours: `42 passed`.
  - **Its residual.** A piece is matched on another line the window's line breaks allow when that line, read alone, prints the same characters at the same edge. It is then written there, beside the mark, and that line becomes a mark: `TOKEN=<BEGIN line>abc<END line>hunter2xyz` followed by `see hunter2xyz` writes `zqx26 [redacted]hunter2xyz` and then a mark. No string is written that this build's per-line reading does not print (Step 1 pins it). A piece more than `RELAY_LOOKBEHIND_BYTES` characters of lines past the first line it may lie on, and not on the last, is written as a mark.
- **One batch per data chunk.** `onOut` emits the line held before the chunk and all of the chunk's complete lines except the last as one text. The last complete line stays held for `decideRelay`, as now.
  - Measured on 10,000 lines of about 100 B (about 1 MB):
    - one redaction per line with no window (today): 161 ms for the 10,000 lines;
    - one windowed redaction per chunk (17 chunks): 316 ms;
    - one windowed redaction per line: 30 s.
  - The per-line cost, about 3 ms a line, arises only when lines arrive one read at a time, that is, from a slow producer. A fast producer's writes merge into large reads. Re-measured with the union and R11's composed doors, on one box under load: about 2.5 ms a line, and 407 to 426 ms for the 10,000 lines in 17 chunks (the fallback bullet above).
- **The per-line reading is memoised by line (the plan's seventh review).** The union's per-line reading runs `redactFinalLines` on each line of the batch alone, so its cost grows with the line count, about 10 us a line with the composed doors, where the base's stderr flush was one `redactFinalLines` over the whole held text. Measured as CPU time (`process.cpuUsage`) on a copy of `bd363a76b` with Tasks 1–3, over 1 MiB of held stderr read as one batch, at a load average of 60 to 100: blank lines 10.5 s against the base's 20 ms; one repeated two-byte line 4.2 s against 133 ms; distinct eight-byte lines 1.6 s against 82 ms; distinct 80-byte lines 0.36 s against 46 ms. `redactFinalLines` is a function of the line and the index alone, and the relay's index is never a probe (`relayIndexOf` builds it with `makePairIndex`), so `redactAfter` reads each distinct line of a batch once and reuses that reading for its repeats: output unchanged (Step 1's relay cases and the maint neighbours green, 39 and 42 passed), and, three runs each under the same load, blank lines 212 to 263 ms, the repeated two-byte line 406 to 492 ms, distinct four-byte lines (the costliest plain shape) 2.8 to 3.0 s against the base's 103 to 119 ms, distinct eight-byte lines 1.8 to 1.9 s, distinct 80-byte lines 342 to 411 ms. No case pins the memo: it changes no output, and a cost ceiling that separates 10 s from 0.25 s under a loaded box's variance would be a load flake. A lazy reading (only the lines a piece is looked up on) would save nothing on a plain stream, whose every line holds a piece.
  - **Its residual.** A flush of 1 MiB of distinct short lines still costs about 3 s of CPU (and 1 MiB of coloured lines about 9 s, the union's residual below). That CPU runs inside each spill past `ERR_HOLD_CAP`, in the close, and in the SIGINT, SIGTERM and SIGHUP handler, which calls `flushErr` synchronously before it arms `setTimeout(raise, SIGNAL_FLUSH_MS)`: the 2 s bound covers the write's drain, not the redaction, so a Ctrl-C on a verb whose shim held such stderr goes unanswered for those seconds (a second signal cannot run until the flush returns). The base's whole-text flush took well under 0.2 s per MiB there. An availability loss, linear in the held text and bounded by the 1 MiB hold, never a leak.
- **The window is cut at a line start.**
  - `keep` is the last 16384 bytes of the raw look-behind and batch, taken from the first line start inside them. A shape that opens a line within the window (a PEM BEGIN line) is therefore kept whole.
  - Only a line longer than the window is kept from mid-line, so a key at the end of a long line still reaches its value when that line is the window's last. When a shorter line follows it in the same batch (a blank line, say), the window is cut at that later line start and drops the key: `'x' * 20000 + ' {"password":'` and a blank line in one batch, then `"hunter2xyz"}` in the next, prints the value (the plan's third review), which a read of the whole text masks. Not a regression against the per-line relay, which printed it too; a named residual, beside a shape longer than the window.
  - The cut never falls inside a UTF-8 character.
- **Lines inside a mark are not written.** A PEM body's later lines and its END line fall inside the mark that the BEGIN line's batch already wrote, so the batch that holds them writes only the text after the END line. With an END line this is cosmetic. Without one, it is not: the PEM shape masks to the end of the text, so while a BEGIN line with no END stays in stdout's look-behind, every later stdout batch is written as one mark, up to `RELAY_LOOKBEHIND_BYTES` of output after it (measured: after `note: the doc quotes <BEGIN line> as an example`, the batches `file a.md ok` and `ERROR: disk full at c.md` were each one mark, where the per-line relay printed them, and 163 lines of 100 B were marks before the next one printed). An availability loss on stdout, never a leak; on stderr the held text was already read whole, so it is not new there. A named residual, pinned in Step 1.
- **A seam inside a line.** A held stderr stretch with no line break past the cap is written mid-line, and `emit` adds a line break there (D-5022). The window joins the two sides at a line break, as the output shows them. A value cut exactly at such a seam is read as two lines (the residual below).
- **Residuals** (R4): a shape longer than the window, and a key at the end of a long line that a shorter line follows in its batch (the bullet above); text written before its key line, which cannot be taken back; a value cut exactly at a mid-line stderr seam, read as two lines (the seam bullet above); the window's raw text in process memory, as stderr's hold already keeps it; on stdout, an unterminated BEGIN line masks the stream's next 16 KiB (an availability loss, the bullet above); and the union's own three: a piece matched on another allowed line that prints the same characters, written beside a mark while that line becomes one; a piece written as a mark where a piece of the window's reading is not where the per-line reading prints it (an availability loss: a line can lose words beside a masked value, or, past the reach bound, the rest of its batch), never a string this build's per-line reading does not print; and, its widest case (the plan's sixth review), a line only the joined reading masks (a NAME a colour sequence splits, `tok\x1b[0men=abc`): the window's reading then removes every escape sequence of the batch, the per-line reading keeps them on each line with nothing to mask, so no piece of a coloured line is placed and every coloured line of the batch, and of later batches while that line is in the look-behind (measured: 166 lines of about 100 B), is a mark, where the base's per-line relay printed them. An availability loss, never a leak, and the union's costliest shape, every piece unplaced: linear, measured 2.0, 3.0 and 5.9 s for 0.25, 0.5 and 1 MiB on one line and 9.1 s for 1 MiB of coloured lines, at a load average of about 44 (Step 1 pins 1 MiB of such lines under the 30 s ceiling; 8 MiB would take about 45 to 75 s). And the held stderr's flush cost: about 3 s of CPU for 1 MiB of distinct short lines with the per-line reading memoised, which the signal handler spends before its `SIGNAL_FLUSH_MS` bound is armed (the memo bullet above; an availability loss).

- [ ] **Step 1: Write the failing pure tests.** Append at the end of `server/test/history-lib.test.ts`:

```ts

// ── W5h-2 Task 3: redactAfter, the relay's look-behind window (D-5747 (history-relay-lookbehind-window)) ─
// Pure, every input a parameter. The relay keeps, per shim stream, the last RELAY_LOOKBEHIND_BYTES of RAW text it has written
// and reads each new batch with it (ruling R4), so a JSON value on the line after its key and a PEM body after its BEGIN line
// are masked though the key or the BEGIN line went out in an earlier batch. JSON and PEM shapes, whose masking does not depend
// on the named rule's value class; the per-line property case also reads NAME:, NAME= and coloured fragments.
describe('redactAfter: a relayed batch is read with its stream\'s look-behind (D-5747)', () => {
  const idx = libRedact.makePairIndex([]);
  const M = libRedact.REDACTED_MARK;
  const WINDOW = 16384;   // R4's window, spelled here so that a mutant of the constant cannot move these pins with it
  // assembled at run time: the repository is public, and a key-shaped literal is what push protection reads
  const BEGIN = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const END = ['-----END ', 'PRIVATE KEY-----'].join('');
  const BODY = 'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8';
  const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
  /** A BEGIN line and body lines of `Q`s, exactly `n` bytes, with no trailing line break. */
  const block = (n: number): string => {
    let s = BEGIN;
    while (n - bytes(s) > 65) s += `\n${'Q'.repeat(64)}`;
    return `${s}\n${'Q'.repeat(n - bytes(s) - 1)}`;
  };

  it('RELAY_LOOKBEHIND_BYTES is 16 KiB (ruling R4)', () => {
    expect(libRedact.RELAY_LOOKBEHIND_BYTES).toBe(WINDOW);
  });

  it('the first batch, with no look-behind: a batch whose every line masks alone is written as redactFinalLines writes it, and its keep is the batch, raw', () => {
    const text = 'zqx26 start\n{"password": "hunter2xyz"}\nzqx26 after';
    const r = libRedact.redactAfter('', text, idx);
    expect(r.emit).toBe(libRedact.redactFinalLines(text, idx));
    expect(r.emit, 'CONTROL: the value is masked').toBe(`zqx26 start\n{"password": "${M}"}\nzqx26 after`);
    expect(r.keep, 'the window holds RAW text, as the held stderr does').toBe(text);
    expect(libRedact.redactAfter('zqx26 before', 'plain line two\nplain line three', idx).emit, 'CONTROL: plain lines are unchanged').toBe('plain line two\nplain line three');
  });

  it('a JSON value on the line after a key in the look-behind is masked; the batch read alone prints it', () => {
    const text = '  "hunter2xyz"}\nzqx26 next line';
    expect(libRedact.redactFinalLines(text, idx), 'CONTROL: alone, the value prints').toBe(text);
    expect(libRedact.redactAfter('zqx26 a\n{"password":', text, idx).emit).toBe(`  "${M}"}\nzqx26 next line`);
    expect(libRedact.redactAfter('{"password":', `\n${text}`, idx).emit, 'a blank line between key and value').toBe(`\n  "${M}"}\nzqx26 next line`);
  });

  it('a PEM body after a BEGIN line in an earlier batch is masked, the window carried from batch to batch by keep', () => {
    const a = libRedact.redactAfter('', `zqx26 start\n${BEGIN}`, idx);
    expect(a.emit, 'CONTROL: the BEGIN line is masked').toBe(`zqx26 start\n${M}`);
    const b = libRedact.redactAfter(a.keep, BODY, idx);
    expect(b.emit, 'a body line is one mark').toBe(M);
    const c = libRedact.redactAfter(b.keep, `${BODY}\n${END}\nzqx26 after`, idx);
    expect(c.emit, 'the last body line and END go into the mark; the line after it is written').toBe('zqx26 after');
    expect(libRedact.redactFinalLines(`${BODY}\n${END}\nzqx26 after`, idx), 'CONTROL: alone, the body prints').toContain(BODY);
  });

  it('a span that runs from the look-behind into the batch writes a mark for the batch\'s part, never the tail it masked', () => {
    const text = 'def"}\nzqx26 ok';
    expect(libRedact.redactFinalLines(text, idx), 'CONTROL: alone, the tail prints').toBe(text);
    expect(libRedact.redactAfter('x {"token": "abc', text, idx).emit).toBe(`${M}"}\nzqx26 ok`);
  });

  it('the batch\'s part is never less masked than the batch read alone: a PEM block the look-behind opens takes the batch\'s NAME into its mark, and the value glued after its END stays masked', () => {
    const lb = `zqx26 ${BEGIN}`;
    const text = `TOKEN=${BEGIN}abc${END}hunter2xyz`;
    expect(libRedact.redactFinalLines(text, idx), 'CONTROL: alone, the final pass reads TOKEN= and masks the value glued after END').toBe(`TOKEN=${M}`);
    expect(libRedact.redactFinalLines(`${lb}\n${text}`, idx), 'CONTROL: read together, the look-behind\'s PEM block runs to the batch\'s END and its mark takes TOKEN=, so the value prints').toContain('hunter2xyz');
    expect(libRedact.redactAfter(lb, text, idx).emit, 'the batch read alone first keeps its mark').toBe(M);
  });

  it('the window: a BEGIN line that starts exactly RELAY_LOOKBEHIND_BYTES back is in reach, and one byte further it is not', () => {
    const next = `${BODY}\n${END}\nzqx26 after`;
    const at = libRedact.redactAfter('', `zqx26 pad\n${block(WINDOW)}`, idx);
    const past = libRedact.redactAfter('', `zqx26 pad\n${block(WINDOW + 1)}`, idx);
    expect(libRedact.redactAfter(at.keep, next, idx).emit, 'in reach: the body is masked').toBe('zqx26 after');
    expect(libRedact.redactAfter(past.keep, next, idx).emit, 'one byte further: the residual, a shape longer than the window').toBe(next);
    expect(bytes(at.keep), 'CONTROL: the window is full, from the BEGIN line').toBe(WINDOW);
    expect(at.keep.startsWith(BEGIN), 'CONTROL: from the BEGIN line').toBe(true);
    expect(past.keep.startsWith(BEGIN), 'CONTROL: one byte further, the BEGIN line is out of the window').toBe(false);
  });

  it('keep: at most RELAY_LOOKBEHIND_BYTES bytes of RAW text, from a line start, mid-line only for a longer line, never inside a character', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(3, '0')}${'L'.repeat(97)}`);
    const k = libRedact.redactAfter('', lines.join('\n'), idx).keep;
    expect(k, 'the longest run of whole lines that fits').toBe(lines.slice(-162).join('\n'));
    expect(bytes(k)).toBeLessThanOrEqual(WINDOW);
    const long = libRedact.redactAfter('', `${'é'.repeat(10000)}x`, idx).keep;
    expect(long, 'one line longer than the window: its last bytes, from a whole character').toBe(`${'é'.repeat(8191)}x`);
    expect(long, 'no replacement character').not.toContain(String.fromCharCode(0xfffd));
    const key = libRedact.redactAfter('', `${'x'.repeat(20000)} {"password":`, idx);
    expect(bytes(key.keep), 'CONTROL: a line longer than the window keeps the window, from mid-line').toBe(WINDOW);
    expect(libRedact.redactAfter(key.keep, '  "hunter2xyz"}', idx).emit, 'so a key at the end of a long line still reaches its value').toBe(`  "${M}"}`);
    expect(libRedact.redactAfter('', `${'a'.repeat(20000)}\nb`, idx).keep, 'the look-behind and the batch are cut together, at the first line start in the window').toBe('b');
  });

  it('the residual, named: a BEGIN line with no END masks what its stream writes after it, until the BEGIN line leaves the window', () => {
    const a = libRedact.redactAfter('', `note: the doc quotes ${BEGIN} as an example`, idx);
    expect(a.emit, 'CONTROL: the PEM shape runs from the BEGIN line to the end of the text').toBe(`note: the doc quotes ${M}`);
    const lines = 'file a.md ok\nERROR: disk full at c.md';
    expect(libRedact.redactFinalLines(lines, idx), 'CONTROL: alone, the lines print, as the per-line relay printed them').toBe(lines);
    const b = libRedact.redactAfter(a.keep, lines, idx);
    expect(b.emit, 'while the BEGIN line is in the look-behind, a later batch is one mark (an availability loss, never a leak)').toBe(M);
    let keep = b.keep;
    let printed = -1;
    for (let i = 0; i < 400 && printed === -1; i += 1) {
      const line = `line ${String(i).padStart(3, '0')} ${'z'.repeat(90)}`;   // 99 bytes, 100 with its line break
      const r = libRedact.redactAfter(keep, line, idx);
      keep = r.keep;
      if (r.emit !== M) {
        printed = i;
        expect(r.emit, 'the first batch written once the BEGIN line has left the window is its own text').toBe(line);
      }
    }
    expect(printed, 'the loss ends').toBeGreaterThan(0);
    expect(printed * 100, 'and is bounded by the window').toBeLessThanOrEqual(WINDOW);
  });

  // Review finding 11 and R4 as restated: the relay never prints a value a line read alone masks. One stdout chunk holding a JSON key
  // and, on the next line, the next pair was the measured regression of the batch read alone: the JSON-form rule reads "password" as
  // token's value and resumes past it. The union writes a mark over every piece the per-line reading does not print, so the next
  // pair is written as one mark from its key on; with the key in the look-behind, the batch's own standalone pass masks the value
  it('one batch holding a JSON key and, on the next line, the next pair: the value is masked as each line alone masks it (review finding 11)', () => {
    const text = 'zqx26 start\n{"token":\n"password": "hunter2xyz"}\nzqx26 after';
    const perLine = text.split('\n').map((line) => libRedact.redactFinalLines(line, idx)).join('\n');
    expect(perLine, 'CONTROL: each line alone masks the value').toBe(`zqx26 start\n{"token":\n"password": "${M}"}\nzqx26 after`);
    expect(libRedact.redactFinalLines(text, idx), 'CONTROL: read as one text, the value prints').toContain('hunter2xyz');
    expect(libRedact.redactAfter('', text, idx).emit, 'in one batch').toBe(`zqx26 start\n{"token":\n"${M}\nzqx26 after`);
    expect(libRedact.redactAfter('zqx26 start\n{"token":', '"password": "hunter2xyz"}\nzqx26 after', idx).emit, 'and with the key in the look-behind').toBe(`"${M}": "${M}"}\nzqx26 after`);
  });

  // R4's fallback, taken at the plan's second review: one batch can hold a PEM block whose mark runs to an END line and takes the next
  // line's NAME in, so the batch read alone prints a value that line read alone masks. No rule change closes it, so redactAfter unions
  // the window's reading with the per-line reading: a mark over every piece of it that the per-line reading does not print on a line
  // the window's line breaks allow (aligned by line at the plan's third review).
  it('one batch holding a PEM block that runs into the next line\'s NAME: the value glued after its END is masked as that line alone masks it (the union)', () => {
    const text = `zqx26 ${BEGIN}\nTOKEN=${BEGIN}abc${END}hunter2xyz`;
    expect(text.split('\n').map((line) => libRedact.redactFinalLines(line, idx)).join('\n'), 'CONTROL: each line alone masks the value').toBe(`zqx26 ${M}\nTOKEN=${M}`);
    expect(libRedact.redactFinalLines(text, idx), 'CONTROL: read as one text, the first BEGIN line\'s mark runs to the END and takes TOKEN= in').toBe(`zqx26 ${M}hunter2xyz`);
    expect(libRedact.redactAfter('', text, idx).emit).toBe(`zqx26 ${M}`);
    // the plan's third review: the union is aligned by line. A search that skipped lines wrote this value where the same
    // characters begin a later line (`zqx26 [redacted]hunter2xyz`), and turned every line up to a later `done` into marks
    expect(libRedact.redactAfter('', `${text}\nhunter2xyzzy.log`, idx).emit, 'the same characters at the start of a later line').toBe(`zqx26 ${M}\nhunter2xyzzy.log`);
    const later = [`zqx26 ${BEGIN}`, `TOKEN=${BEGIN}abc${END}done`, 'file a.md ok', 'file b.md ok', 'file c.md ok', 'all done'].join('\n');
    expect(libRedact.redactAfter('', later, idx).emit, 'the lines up to a later occurrence are written').toBe(`zqx26 ${M}\nfile a.md ok\nfile b.md ok\nfile c.md ok\nall done`);
    // a piece that ends its line is matched only where a line of the per-line reading ends with it
    const inWord = [`zqx26 ${BEGIN}`, `TOKEN=${BEGIN}abc${END}hunter2xyz`, 'hunter2xyzzy.log', `zqx26 ${BEGIN}`, `x ${END}`].join('\n');
    expect(libRedact.redactAfter('', inWord, idx).emit, 'not inside a longer word').toBe(`zqx26 ${M}\nhunter2xyzzy.log\nzqx26 ${M}`);
    // the residual, named: where the same characters END another line the window's line breaks allow, they are written beside
    // the mark, and that line, which printed them alone, is written as a mark (no string the per-line relay did not write)
    const residual = [`zqx26 ${BEGIN}`, `TOKEN=${BEGIN}abc${END}hunter2xyz`, 'see hunter2xyz', `zqx26 ${BEGIN}`, `x ${END} ok`].join('\n');
    expect(libRedact.redactAfter('', residual, idx).emit, 'the residual').toBe(`zqx26 ${M}hunter2xyz\n${M}\n${M} ok`);
    // bounded: a piece is looked for on at most RELAY_LOOKBEHIND_BYTES characters of the lines past the first it may lie on, then
    // on the last. 8 MiB in which the window's reading drops one line break in every three lines and every third line's value
    // is not where that reading puts it: the search without that bound took over a minute. The bound is a ceiling, not the detector
    const unit = `${'a'.repeat(90)}\nz ${BEGIN}\nTOKEN=${BEGIN}a${END}aaab password: v\n`;
    const big = unit.repeat(Math.ceil((8 << 20) / unit.length)).slice(0, 8 << 20);
    const t0 = Date.now();
    libRedact.redactAfter('', big, idx);
    expect(Date.now() - t0, '8 MiB').toBeLessThan(30_000);
    // the plan's sixth review, a residual named: a line only the joined reading masks (a NAME a colour sequence splits) has the
    // window's reading remove every sequence of the batch, so the per-line reading, which keeps them on a line with nothing to mask,
    // places no piece of a coloured line, and each is a mark (an availability loss; the base's per-line relay printed them). It is
    // the union's costliest shape, every piece unplaced, and linear: 1 MiB of such lines, under the same ceiling
    const coloured = ['tok\x1b[0men=abc', 'file \x1b[32ma.md\x1b[0m ok', 'file \x1b[32mb.md\x1b[0m ok', 'plain line'].join('\n');
    expect(libRedact.redactAfter('', coloured, idx).emit, 'every coloured line of the batch is a mark').toBe(`token=${M}\n${M}\n${M}\nplain line`);
    const cunit = 'file \x1b[32ma.md\x1b[0m ok\n';
    const cbig = `tok\x1b[0men=abc\n${cunit.repeat(Math.ceil((1 << 20) / cunit.length))}`.slice(0, 1 << 20);
    const t1 = Date.now();
    libRedact.redactAfter('', cbig, idx);
    expect(Date.now() - t1, '1 MiB of coloured lines after such a line').toBeLessThan(30_000);
  }, 300_000);

  it('every value a line read alone masks is masked in the batch: f2Cases (the (j3) corpus) and every two- and three-line batch of JSON, NAME:, NAME= and PEM fragments, with no look-behind and after the first line (R4, review finding 11)', () => {
    const violations: string[] = [];
    let masked = 0;
    // a reading may remove a line's escape sequences and glue the text either side (D-4307's joined reading), so a value is held by
    // a text that holds it with or without the sequences inside it, and masked by a line that holds it in neither form
    const SEQ = String.raw`(?:\x1b\[(?!redacted\])[0-?]*[ -/]*[@-~]|\x1b[ -/]*(?!\[redacted\])[0-~])*?`;
    const holds = (t: string, v: string): boolean => (t.includes('\x1b') ? new RegExp([...v].join(SEQ)).test(t) : t.includes(v));
    /** `planted[i]` is the value planted in `lines[i]`, or null. A value line i alone masks must not print in the batch, and, with line 0
     *  as the look-behind, a value line 0 alone masks must not be written again. */
    const check = (lines: string[], planted: Array<string | null>): void => {
      const one = libRedact.redactAfter('', lines.join('\n'), idx).emit;
      const after = lines.length > 1 ? libRedact.redactAfter(lines[0]!, lines.slice(1).join('\n'), idx).emit : '';
      lines.forEach((line, i) => {
        const v = planted[i];
        if (v === null || v === undefined || holds(libRedact.redactFinalLines(line, idx), v)) return;
        masked += 1;
        if (holds(one, v)) violations.push(`one batch: ${JSON.stringify(lines.join('\n'))} shows ${v}`);
        if (i > 0 && holds(after, v)) violations.push(`after the first line: ${JSON.stringify(lines.join('\n'))} shows ${v}`);
        if (i === 0 && lines.length > 1 && holds(after, v)) violations.push(`the look-behind written again: ${JSON.stringify(lines.join('\n'))} shows ${v}`);
      });
    };
    // the measured regressions first, so a red names them: review finding 11's, the PEM block that takes the next line's NAME in, and
    // a value whose next line starts with a colon
    check(['zqx26 start', '{"token":', '"password": "hunter2xyz"}', 'zqx26 after'], [null, null, 'hunter2xyz', null]);
    check([`zqx26 ${BEGIN}`, `TOKEN=${BEGIN}abc${END}hunter2xyz`], [null, 'hunter2xyz']);
    check(['zqx26 start', '"token": "hunter2xyz"', ': x'], [null, 'hunter2xyz', null]);
    const FR: Array<(v: string) => string> = [
      () => '{"token":', () => '"password":', () => '  "api_key" :', () => '{"secret":',
      (v) => `  "${v}"}`, (v) => `"${v}",`, (v) => `"password": "${v}"}`, (v) => `{"token": "${v}"}`, (v) => `"auth":"${v}",`,
      () => 'token:', () => 'password: ', () => 'API_KEY:', (v) => `password: ${v}`, (v) => `API_KEY: ${v}`, (v) => `secret: "${v}"`,
      () => 'TOKEN=', () => 'export PASSWORD=', (v) => `PASSWORD=${v}`, (v) => `export SECRET="${v}"`, (v) => `token=${v}&next=1`,
      () => BEGIN, (v) => `MIIB${v}QQQQ`, () => END, () => 'zqx26 plain note', () => 'level=INFO path=/a/b',
      // the plan's second review: a pair that ends its line, colon-led lines, and a value glued after an END on a NAME's line
      (v) => `"token": "${v}"`, () => ':', () => '  : x', (v) => `TOKEN=${BEGIN}abc${END}${v}`,
      // a secret pair's value that a colon follows on its line
      (v) => `"password": "${v}": x`,
      // the plan's sixth review: a NAME or a value a colour sequence splits, which the joined reading reads whole (D-4307), and a
      // coloured line that holds nothing to mask
      (v) => `pass\x1b[0mword=${v}`, () => 'tok\x1b[0men=&x', (v) => `PASSWORD=${v.slice(0, 3)}\x1b[32m${v.slice(3)}`,
      () => 'file \x1b[32ma.md\x1b[0m ok',
    ];
    let n = 0;
    const mk = (f: (v: string) => string): [string, string | null] => {
      const v = `zqv${(n++).toString(36).padStart(4, '0')}k`;
      const line = f(v);
      return [line, line.includes(v) ? v : null];
    };
    for (const a of FR) {
      for (const b of FR) {
        const [x, y] = [mk(a), mk(b)];
        check([x[0], y[0]], [x[1], y[1]]);
        for (const c of FR) {
          const [p, q, r] = [mk(a), mk(b), mk(c)];
          check([p[0], q[0], r[0]], [p[1], q[1], r[1]]);
        }
      }
    }
    // the (j3) corpus, each case's planted run renamed per line, so a value one line prints is never another line's
    const cases = f2Cases();
    const f2 = (input: string, k: number): [string, string] => [input.replaceAll('cdXQ9', `cdXQ9${'abc'[k]}`), `cdXQ9${'abc'[k]}`];
    for (const c1 of cases) for (const c2 of cases) { const [x, y] = [f2(c1.input, 0), f2(c2.input, 1)]; check([x[0], y[0]], [x[1], y[1]]); }
    for (let i = 0; i + 2 < cases.length; i += 1) {
      const [x, y, z] = [f2(cases[i]!.input, 0), f2(cases[i + 1]!.input, 1), f2(cases[i + 2]!.input, 2)];
      check([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
    }
    expect(masked, 'CONTROL: thousands of values each line alone masks').toBeGreaterThan(10_000);
    expect(violations.slice(0, 5), `${violations.length} of ${masked}`).toEqual([]);
  }, 120_000);
});
```

The `é` is the one character U+00E9 (two UTF-8 bytes). Write it as itself, never as an escape sequence, and check it with `grep -c "'é'.repeat(10000)" server/test/history-lib.test.ts` (prints 1).

- [ ] **Step 2: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5747')
```

The filter selects this describe's 12 cases and nothing else. Expected red: `12 failed`, measured on a copy of `bd363a76b` with Tasks 1 and 2 applied and this task's lib section left out. The first case fails with `expected undefined to be 16384`, and the other eleven with `TypeError: redactAfter is not a function`.

- [ ] **Step 3: Write the lib function.** In `ccd/history/lib.mjs`, directly after the three lines

```js
export function redactFinalLines(text, idx) {
  return composeDoor(DOOR_READINGS.redactFinalLines, [text, idx], idx);
}
```

(Task 1's text of it; at the base its body was `  return redactFinal(redactField(text, idx), idx);`)

insert:

```js

/** How much of a relayed stream's own RAW text the relay keeps behind what it has written, to read the next batch in context:
 *  16 KiB, which holds a 4096-bit PEM private key (about 3.3 KB) several times over. D-5747 (history-relay-lookbehind-window) */
export const RELAY_LOOKBEHIND_BYTES = 16384;

/** The relay's next look-behind (D-5747): the last RELAY_LOOKBEHIND_BYTES UTF-8 bytes of `raw`, never starting inside a
 *  character, and from the first line start inside them, so a shape that opens a line (a PEM BEGIN line) within the window is
 *  kept whole. With no line start inside them (one line longer than the window) they are kept from mid-line. Every UTF-16 unit
 *  is at least one UTF-8 byte, so those bytes lie in the last RELAY_LOOKBEHIND_BYTES units. */
function relayKeep(raw) {
  if (Buffer.byteLength(raw, 'utf8') <= RELAY_LOOKBEHIND_BYTES) return raw;
  const from = Math.max(0, raw.length - RELAY_LOOKBEHIND_BYTES);
  const enc = Buffer.from(raw.slice(from), 'utf8');
  let at = enc.length - RELAY_LOOKBEHIND_BYTES;
  while (at < enc.length && (enc[at] & 0xc0) === 0x80) at += 1;
  const tail = enc.subarray(at).toString('utf8');
  if (at > 0 ? enc[at - 1] === 0x0a : raw[from - 1] === '\n') return tail;
  const nl = tail.indexOf('\n');
  return nl === -1 ? tail : tail.slice(nl + 1);
}

/** One relayed batch of a stream's text, read in the context of what the same stream wrote before it: the window's
 *  reading, which redactAfter unions with the per-line reading. D-5747 (history-relay-lookbehind-window), amending
 *  D-5022's final shape.
 *
 *  `lookBehind` is the stream's own RAW text that the relay has already written, at most RELAY_LOOKBEHIND_BYTES of it, or ''
 *  before the first batch. `text` is the next batch, which the relay writes as whole lines (emit adds the last line break); it
 *  joins the look-behind at a line break. Three readings:
 *    - A, the batch read ALONE (redactFinalLines), first: the standalone pass. Its marks are carried into the next reading,
 *      where a mark stays a mark, so what is written is never less masked than A. Run last instead, over the context
 *      reading's output, it would not be: a PEM block the look-behind opens can run to an END line in the batch, and its
 *      mark then takes in a NAME the batch read alone keeps (`TOKEN=<BEGIN line>…<END line>V`), so no pass sees a NAME
 *      before V;
 *    - R, the look-behind and A read as ONE text;
 *    - P, the look-behind read alone, which the relay already wrote (redacted).
 *  Written: the rest of R when R starts with P and a line break. Otherwise a span runs from the look-behind into the batch,
 *  and what is written is R from the last mark that starts at or before the first character where R and P differ and
 *  reaches it (that mark stands for the span's new tail), or, with no such mark, from the start of that character's line.
 *  `keep` is the next look-behind: the RAW look-behind and batch, cut by relayKeep.
 *  This reading alone does not keep the per-line guarantee (R4 as amended on review finding 11): one batch can hold a PEM
 *  block whose mark runs to an END line and takes the next line's NAME in (`<BEGIN line>`, then `TOKEN=<BEGIN line>abc<END
 *  line>V` prints V, which that line read alone masks), and the line-start branch can write look-behind text again.
 *  redactAfter's union (relayUnion) closes both, and review finding 11's JSON key and next pair in one batch too: this
 *  reading takes the next pair's key as the key's value and prints its value, and the union writes that pair as one mark
 *  from its key on. Each reading here is this build's redactFinalLines, a composed door (R11).
 *  Residuals: a shape longer than the window; text written before its key line cannot be taken back; the window's raw text
 *  sits in process memory, as the held stderr already does. */
function relayRead(lookBehind, text, idx) {
  const alone = redactFinalLines(text, idx);
  const keep = relayKeep(lookBehind === '' ? text : `${lookBehind}\n${text}`);
  if (lookBehind === '') return { emit: alone, keep };
  const head = `${redactFinalLines(lookBehind, idx)}\n`;
  const R = redactFinalLines(`${lookBehind}\n${alone}`, idx);
  if (R.startsWith(head)) return { emit: R.slice(head.length), keep };
  let d = 0;
  while (d < head.length && d < R.length && R[d] === head[d]) d += 1;
  const m = R.lastIndexOf(REDACTED_MARK, d);
  return { emit: m !== -1 && m + REDACTED_MARK.length >= d ? R.slice(m) : R.slice(R.lastIndexOf('\n', d - 1) + 1), keep };
}

/** R4's fallback, taken at the plan's second review and aligned by line at its third (D-5747): `read`, the window's reading
 *  of one batch, with a mark over every piece of it that `perLine` (the same batch read one line at a time by this build's
 *  redactFinalLines, as the relay before this wave read it) does not print where that piece can lie. `read` is split at its marks and line breaks. A
 *  mark only ever takes text in, so each line break `read` keeps is one of the batch's, in order, and `perLine` keeps them
 *  all, one line per batch line. So a piece lies on the line the breaks since the last piece written count to when no mark
 *  stands between them, and otherwise on a line no earlier than that and no later than the breaks after it allow. On such
 *  a line, a piece that starts its line in `read` must start the line of `perLine`, one that ends its line must end it, and
 *  one between two marks is looked for after the last piece written. The lines are tried in order, at most
 *  RELAY_LOOKBEHIND_BYTES characters of them past the first, and then the last line allowed (one mark that takes in every
 *  break, a long PEM body, say). A piece found is written; a piece not found becomes a mark, and marks that meet are
 *  written as one. So every piece written is text the per-line reading prints on a line the window's line breaks allow, and
 *  a mark of `read` stays a mark, so what is written is never less masked than `read`. A piece the line-start branch wrote
 *  again from the look-behind is not on any line of `perLine`, so it becomes a mark. A union of the text written, not of
 *  spans over the original text: no reading of redactFinalLines answers spans (it composes two passes that answer text).
 *  Each piece costs at most two lines and RELAY_LOOKBEHIND_BYTES characters of the lines between, and the output is joined
 *  once, so the union stays near linear in the batch (an unaligned search that scanned to the batch's end for each piece
 *  it missed, and a mark test that read the growing output's end, were each quadratic). */
function relayUnion(read, perLine) {
  const lines = perLine.split('\n');
  const toks = [];   // the pieces of `read`, in order: text, null for a mark, '\n' for a line break
  read.split(REDACTED_MARK).forEach((part, i) => {
    if (i > 0) toks.push(null);
    part.split('\n').forEach((piece, j) => {
      if (j > 0) toks.push('\n');
      if (piece !== '') toks.push(piece);
    });
  });
  let breaksLeft = toks.filter((t) => t === '\n').length;
  let line = 0;      // the line of perLine where the last piece written ends, and its column
  let col = 0;
  let breaks = 0;    // the line breaks written since then
  let open = true;   // a mark since then: the look-behind's own mark may take in the batch's first lines
  const out = [];
  const mark = () => {
    if (out[out.length - 1] !== REDACTED_MARK) out.push(REDACTED_MARK);
  };
  toks.forEach((piece, i) => {
    if (piece === '\n') {
      out.push('\n');
      breaks += 1;
      breaksLeft -= 1;
      return;
    }
    if (piece === null) {
      mark();
      open = true;
      return;
    }
    const startsLine = i === 0 || toks[i - 1] === '\n';
    const endsLine = i === toks.length - 1 || toks[i + 1] === '\n';
    const find = (L) => {
      const s = lines[L];
      const from = L === line ? col : 0;
      if (startsLine) return from === 0 && (endsLine ? s === piece : s.startsWith(piece)) ? 0 : -1;
      if (endsLine) return s.length - piece.length >= from && s.endsWith(piece) ? s.length - piece.length : -1;
      const k = s.slice(from, from + RELAY_LOOKBEHIND_BYTES + piece.length).indexOf(piece);
      return k === -1 ? -1 : from + k;
    };
    const lo = line + breaks;
    const hi = open ? lines.length - 1 - breaksLeft : lo;
    let L = lo;
    let k = L <= hi ? find(L) : -1;
    for (let reach = 0; k === -1 && L + 1 < hi && reach <= RELAY_LOOKBEHIND_BYTES; ) {
      reach += lines[L].length + 1;
      L += 1;
      k = find(L);
    }
    if (k === -1 && L < hi) {
      L = hi;
      k = find(L);
    }
    if (k === -1) {
      mark();
      open = true;
      return;
    }
    out.push(piece);
    line = L;
    col = k + piece.length;
    breaks = 0;
    open = false;
  });
  return out.join('');
}

/** One relayed batch of a stream's text, as the relay writes it. D-5747 (history-relay-lookbehind-window), amending D-5022's
 *  final shape; ruling R4 as amended. `lookBehind` is the stream's own RAW text that the relay has already written, at most
 *  RELAY_LOOKBEHIND_BYTES of it, or '' before the first batch; `text` is the next batch, whole lines joined by line breaks
 *  (emit adds the last). `emit` is what to write for `text`: the window's reading (relayRead) unioned with the batch read
 *  one line at a time (relayUnion). `keep` is the next look-behind. What is written is never less masked than
 *  redactFinalLines of the batch alone (relayRead's standalone pass runs first), and every piece of it is text that this
 *  build's redactFinalLines prints reading each line alone, on a line the window's line breaks allow (the union): a value a
 *  line alone masks is written only where another line of the batch, read alone, prints the same characters. This build's
 *  redactFinalLines reads the widened rules only over the rev 3.6 door's output (R11), so its per-line reading masks every
 *  value the per-line relay before this wave masked. The per-line reading is memoised by line within the batch:
 *  redactFinalLines is a function of the line and the index alone (the relay's index is never a probe), so a blank or
 *  repeated line is read once, and a held stderr of short lines costs per distinct line, not per line (the plan's seventh
 *  review measured 10 s of CPU on 1 MiB of blank lines without it). */
export function redactAfter(lookBehind, text, idx) {
  const { emit, keep } = relayRead(lookBehind, text, idx);
  const seen = new Map();
  const perLine = text.split('\n').map((line) => {
    let read = seen.get(line);
    if (read === undefined) {
      read = redactFinalLines(line, idx);
      seen.set(line, read);
    }
    return read;
  }).join('\n');
  return { emit: relayUnion(emit, perLine), keep };
}
```

In `ccd/history/lib.d.mts`, directly after the line `export function redactFinalLines(text: string, idx: PairIndex): string;`, insert:

```ts
export const RELAY_LOOKBEHIND_BYTES: 16384;
export function redactAfter(lookBehind: string, text: string, idx: PairIndex): { emit: string; keep: string };
```

Check that each name is declared once. `skipLibCheck` hides a duplicate, so count them: `grep -c '^export const RELAY_LOOKBEHIND_BYTES\|^export function redactAfter(' ccd/history/lib.mjs ccd/history/lib.d.mts` prints `2` for each file (one line per name). `grep -c '^function relayRead(\|^function relayUnion(\|^function relayKeep(' ccd/history/lib.mjs` prints `3`, and none of the three is in `lib.d.mts`.

- [ ] **Step 4: Run them and see them pass, then the file and the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5747')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `12 passed` (measured on a copy of `bd363a76b` with Tasks 1–3 as now written). The property case takes about 3 s, and the union case, with its 8 MiB input, about 4 s, before the plan's sixth review; with its coloured fragments and its 1 MiB of coloured lines, 14.0 s and 14.8 s at a load average of about 40 (6.7 s for the property case without them, at the same load).
- The whole file is green: `1124 passed` on that copy (the base's 1083, Task 1's 6, Task 2's 23 and this task's 12), in about 107 s. After 5h-1 it is 5h-1's count plus the same 41. This task is not run without Task 1: its relay reads Task 1's composed doors, and its figures were measured with them.
- tsc reports nothing in a history file. Measured: the only lines are the worktree install's (`agent/src/server.ts` and `test/workflow-yaml-parses.test.ts`, which name modules that are not installed).

- [ ] **Step 5: Bind the constant in single-definition.** Measured at `bd363a76b` with Step 3 applied: `VOCABS` is an explicit list, so a second `const RELAY_LOOKBEHIND_BYTES` placed in `cli.mjs` leaves `single-definition -t 'ccrc history'` green (`92 passed`), and nothing would see it. In `server/test/single-definition.test.ts`, in the O14 describe's `VOCABS`, replace the one line

```ts
    'BELT_COUNTERS', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META',
```

with

```ts
    'BELT_COUNTERS', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META',
    // W5h-2 Task 3 (D-5747): the operator relay's look-behind window, declared once in lib.mjs.
    'RELAY_LOOKBEHIND_BYTES',
```

Then run:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Expected (measured): `93 passed`. The new case `RELAY_LOOKBEHIND_BYTES is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen` is green. Its mutant is Step 10's M13.

- [ ] **Step 6: Write the failing delivery tests.** Two files.

(a) Append at the end of `server/test/history-maint.test.ts`:

```ts

// ── W5h-2 Task 3: the relay reads each shim stream through a look-behind window (D-5747 (history-relay-lookbehind-window)) ─
// D-5022 left stdout per line, so a JSON value on the line after its key and a PEM body after its BEGIN line printed in
// clear; and stderr's 1 MiB spill was a seam no pass saw across. Each SOURCE stream now keeps its last RELAY_LOOKBEHIND_BYTES
// of raw text, and every batch is redacted with it (lib redactAfter). The shapes here are JSON and PEM, whose masking does
// not depend on the named rule's value class. No case here waits on a clock: the split cases have the stand-in write one
// part, touch a marker and wait (bounded) for a go-file the case writes only once the first part has reached the terminal.
describe.skipIf(process.platform === 'darwin')('the relay reads each shim stream through a look-behind window: a shape split across lines, chunks or the stderr spill is masked (D-5747)', () => {
  const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const alnum = (n: number): string => Array.from(randomBytes(n), (b) => AL[b % AL.length]!).join('');
  // assembled at run time: the repository is public, and a key-shaped literal is what push protection reads
  const BEGIN = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const END = ['-----END ', 'PRIVATE KEY-----'].join('');
  const BODY1 = 'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8';
  const BODY2 = 'MIIBzqx26AAAABBBBCCCCDDDDEEEEFFFFGGGGHHH';
  const until = async (ok: () => boolean, ms = 30_000): Promise<void> => {
    const t0 = Date.now();
    while (!ok()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for the stand-in shim');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  /** A stand-in line that waits (bounded, 120 s) for a go-file, after touching its marker. */
  const waitFor = (box: HistoryBox, n: number): string[] => [
    `touch ${JSON.stringify(path.join(box.home, `wrote${n}`))}`,
    `for i in $(seq 1 1200); do [ -e ${JSON.stringify(path.join(box.home, `go${n}`))} ] && break; sleep 0.1; done`,
  ];
  const sq = (s: string): string => `'${s}'`;

  it('a JSON value on the line after its key and a PEM body after its BEGIN line, on the shim\'s stdout, reach the terminal masked, in order, human and --json', () => {
    const V = `hunter2${alnum(12)}`;
    const box = boundBox('ccrc-hist-relay-lb1-');
    stubShim(box, {
      stdout: `zqx26 start\n{"password":\n  "${V}"}\nzqx26 mid\n${BEGIN}\n${BODY1}\n${BODY2}\n${END}\nzqx26 after\n{"rc":0}\n`, exit: 0,
    });
    const h = op(box, ['doctor', '--backup']);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(h.code, h.stderr).toBe(0);
    expect(j.code, j.stderr).toBe(0);
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      const lines = text.split('\n');
      expect(lines, `CONTROL ${where}: the lines around the shapes arrive unchanged`).toEqual(expect.arrayContaining(['zqx26 start', '{"password":', 'zqx26 mid', 'zqx26 after']));
      expect(lines.indexOf('zqx26 start'), `${where}: arrival order`).toBeLessThan(lines.indexOf('zqx26 mid'));
      expect(lines.indexOf('zqx26 mid'), `${where}: arrival order`).toBeLessThan(lines.indexOf('zqx26 after'));
      expect(text, `${where}: the JSON value on the line after its key`).not.toContain(V);
      expect(text, `${where}: the PEM body`).not.toContain('MIIB');
      expect(lines, `${where}: the value's line keeps its quotes, the mark inside`).toContain(`  "${REDACTED_MARK}"}`);
    }
    expect(h.stdout, 'CONTROL: the result line is not relayed').not.toContain('{"rc"');
  }, HEAVY);

  for (const form of [[], ['--json']] as const) {
    it(`the same shapes with the key and the value in SEPARATE writes are masked by the window, and stdout stays live${form.length ? ' (--json)' : ''}`, async () => {
      const V = `hunter2${alnum(12)}`;
      const box = boundBox(`ccrc-hist-relay-lb2${form.length ? 'j' : 'h'}-`);
      rawShim(box, [
        `printf '%s\\n' 'zqx26 start' ${sq(BEGIN)} ${sq(BODY1)}`,
        ...waitFor(box, 1),
        `printf '%s\\n' ${sq(BODY2)} ${sq(END)} 'zqx26 mid' '{"password":' ''`,
        ...waitFor(box, 2),
        `printf '%s\\n' '  "${V}"}' 'zqx26 after' '{"rc":0}'`,
      ]);
      const cli = startCli(box, ['doctor', '--backup', ...form]);
      const seen = (): string => (form.length ? cli.peek().stderr : cli.peek().stdout);
      let liveStart = false;
      let liveMid = false;
      try {
        await until(() => fs.existsSync(path.join(box.home, 'wrote1')));
        await until(() => seen().includes('zqx26 start\n'));
        liveStart = true;
        fs.writeFileSync(path.join(box.home, 'go1'), '');
        await until(() => fs.existsSync(path.join(box.home, 'wrote2')));
        await until(() => seen().includes('zqx26 mid\n'));
        liveMid = true;
      } finally {
        fs.writeFileSync(path.join(box.home, 'go1'), '');
        fs.writeFileSync(path.join(box.home, 'go2'), '');   // the stand-in ends either way
      }
      const r = await cli.done;
      expect(r.code, r.stderr.slice(0, 300)).toBe(0);
      expect([liveStart, liveMid], 'CONTROL: each part reached the terminal before the next was written, so the key and the value were relayed apart').toEqual([true, true]);
      const text = form.length ? r.stderr : r.stdout;
      expect(text, 'the PEM body, written after its BEGIN line had been relayed').not.toContain('MIIB');
      expect(text, 'the JSON value, written after its key had been relayed').not.toContain(V);
      expect(text.split('\n'), 'CONTROL: the line after each shape arrives unchanged').toEqual(expect.arrayContaining(['zqx26 start', 'zqx26 mid', 'zqx26 after']));
      expect(text, 'CONTROL: a mark stands').toContain(REDACTED_MARK);
    }, HEAVY);
  }

  it('a JSON key just before the stderr spill seam and its value just after it: the value is masked across the seam', async () => {
    const V = `hunter2${alnum(12)}`;
    const box = boundBox('ccrc-hist-relay-lb3-');
    const CAP_LINE = `zqx26 ${'y'.repeat(121)}`;   // 128 bytes with its line break: exactly 1 MiB is 8,192 lines
    rawShim(box, [
      // exactly the 1 MiB hold, then the key line in ONE write: the hold goes over the cap with it, so the spill writes through it
      `yes ${JSON.stringify(CAP_LINE)} 2>/dev/null | head -c ${1 << 20} >&2`,
      'printf \'%s\\n\' \'{"password":\' >&2',
      ...waitFor(box, 1),
      `printf '%s\\n' '  "${V}"}' 'zqx26 after' >&2`,
      'printf \'%s\\n\' \'{"rc":0}\'',
    ]);
    const cli = startCli(box, ['doctor', '--backup']);
    let spilled = false;
    try {
      await until(() => fs.existsSync(path.join(box.home, 'wrote1')), 60_000);
      await until(() => cli.peek().stderr.endsWith('{"password":\n'));
      spilled = true;
    } finally {
      fs.writeFileSync(path.join(box.home, 'go1'), '');
    }
    const r = await cli.done;
    expect(r.code, r.stderr.slice(0, 300)).toBe(0);
    expect(spilled, 'CONTROL: the spill wrote through the key line before the value was written: the shape is split across the seam').toBe(true);
    const lines = r.stderr.split('\n');
    expect(lines.filter((l) => l === CAP_LINE), 'CONTROL: every line before the seam arrives').toHaveLength(8192);
    expect(r.stderr, 'the value after the seam').not.toContain(V);
    expect(lines, 'the value\'s line keeps its quotes, the mark inside').toContain(`  "${REDACTED_MARK}"}`);
    expect(lines, 'CONTROL: the line after it arrives unchanged').toContain('zqx26 after');
  }, 1.5 * HEAVY);

  it('the windows are keyed by the shim\'s stream, never by where the CLI writes it: a PEM left open on stdout does not mask a stderr line, human and --json', () => {
    const box = boundBox('ccrc-hist-relay-lb4-');
    // stdout's window ends in an unterminated PEM block when the child closes; the held stderr is written at the close
    stubShim(box, {
      stderr: 'zqx26 err plain line\n',
      stdout: `zqx26 start\n${BEGIN}\n${BODY1}\n{"rc":0}\n`, exit: 0,
    });
    const h = op(box, ['doctor', '--backup']);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(h.code, h.stderr).toBe(0);
    expect(j.code, j.stderr).toBe(0);
    expect(h.stderr, 'human: the stderr line arrives as written').toBe('zqx26 err plain line\n');
    expect(j.stderr.split('\n'), '--json: the stderr line arrives as written, beside stdout\'s lines').toContain('zqx26 err plain line');
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      expect(text, `CONTROL ${where}: the PEM is masked`).not.toContain('MIIB');
      expect(text.split('\n'), `CONTROL ${where}: the line before it arrives`).toContain('zqx26 start');
    }
  }, HEAVY);

  it('a JSON key and, on the next line, the next pair, in ONE stdout chunk: the value is masked as each line alone masks it, human and --json (review finding 11)', () => {
    const V = `hunter2${alnum(12)}`;
    const box = boundBox('ccrc-hist-relay-lb5-');
    stubShim(box, { stdout: `zqx26 start\n{"token":\n"password": "${V}"}\nzqx26 after\n{"rc":0}\n`, exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(h.code, h.stderr).toBe(0);
    expect(j.code, j.stderr).toBe(0);
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      expect(text, `${where}: the value`).not.toContain(V);
      const lines = text.split('\n');
      // read as one text, the JSON-form rule takes "password" as token's value and the value prints; the union writes the next pair
      // as one mark from its key on, where the per-line reading prints the key and masks the value
      expect(lines, `${where}: the next pair is one mark from its key on`).toContain(`"${REDACTED_MARK}`);
      expect(lines, `CONTROL ${where}: the lines around it arrive unchanged`).toEqual(expect.arrayContaining(['zqx26 start', '{"token":', 'zqx26 after']));
    }
  }, HEAVY);

  // The plan's second review: one more one-chunk shape the per-line relay masked. A PEM block whose mark runs to an END line takes the
  // next line's NAME in (the union's pin).
  it('a PEM block that runs into the next line\'s NAME, in ONE stdout chunk: the value glued after its END is masked as its line alone masks it, human and --json', () => {
    const V1 = `hunter2${alnum(12)}`;
    const box = boundBox('ccrc-hist-relay-lb6-');
    stubShim(box, { stdout: `zqx26 start\nzqx26 ${BEGIN}\nTOKEN=${BEGIN}abc${END}${V1}\nzqx26 after\n{"rc":0}\n`, exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(h.code, h.stderr).toBe(0);
    expect(j.code, j.stderr).toBe(0);
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      expect(text, `${where}: the value glued after END, whose NAME the PEM mark took in`).not.toContain(V1);
      expect(text.split('\n'), `CONTROL ${where}: the lines around it arrive unchanged`).toEqual(expect.arrayContaining(['zqx26 start', 'zqx26 after']));
    }
  }, HEAVY);
});
```

Why the split cases need no clock:
- The stand-in cannot touch `wrote<n>` until the CLI has accepted every byte before it, because a pipe holds 64 KiB.
- The case writes `go<n>` only once the part before it has reached the terminal, and it waits on that output (bounded), never on a time.
- The key line of the spill case is a single 13-byte write. Pipe writes of up to 4096 bytes are atomic, so it arrives whole in the read that takes the hold over the cap.

(b) In `server/test/history-cli.test.ts`, in H-32, replace the one line

```ts
    expect(src).toContain('emit(redactFinalLines(line, idx), toStderr)');
```

with

```ts
    // D-5747 (W5h-2 Task 3): the relay's emit reads each SOURCE stream through its look-behind, lib redactAfter, whose every reading is redactFinalLines
    expect(src).toContain('const r = healthLib.redactAfter(behind[k], text, idx);');
    expect(src).toContain('emit(r.emit, fromStderr);');
```

- [ ] **Step 7: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5747')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'prints an error message except through errLine')
```

The first filter selects this describe's 7 cases and the second selects H-32 alone (measured: `118 skipped` and `72 skipped` beside them at the base).

Expected red, measured on a copy of `bd363a76b` with Tasks 1 and 2 applied and `cli.mjs` as at the base:
- history-maint: `6 failed | 1 passed`:
  - the one-chunk case fails with `human stdout: the JSON value on the line after its key: expected 'zqx26 start\n{"password":\n  "hunter2…' not to contain 'hunter2…'`;
  - both split cases fail with `the PEM body, written after its BEGIN line had been relayed: expected 'zqx26 start\n[redacted]\nMIIBVgIBADAN…' not to contain 'MIIB'`. Their liveness CONTROLs pass, because the base relays stdout live;
  - the spill case fails with `the value after the seam: expected 'zqx26 yyyy…' not to contain 'hunter2…'`;
  - the keyed case fails on its own CONTROL, `CONTROL human stdout: the PEM is masked`, because the base's per-line stdout prints the PEM body. Its main assertion (the stderr line arrives as written) holds at the base, which has no window at all; that assertion is red only under its mutant (Step 10's M12);
  - review finding 11's one-chunk case fails on its shape, `human stdout: the next pair is one mark from its key on: expected [ 'zqx26 start', '{"token":', …(3) ] to include '"[redacted]'`: the base relays stdout one line at a time, and each line alone prints the key and masks the value, so its value assertion holds there. With the batch relay in place it is red only under Step 10's M15 (the union dropped), on the value;
  - the PEM one-chunk case passes for the same reason: each line alone masks its value. It is red only under Step 10's M15.
- history-cli: `1 failed`, `expected '#!/usr/bin/env node\n// ccd/history/c…' to contain 'const r = healthLib.redactAfter(behin…'`.

- [ ] **Step 8: Write the relay.** In `ccd/history/cli.mjs`:

(a) In `opRelay`, replace

```js
    const onOut = safe((d) => {
      buf += d;
      for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
        take(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
```

with

```js
    // D-5747 (history-relay-lookbehind-window): each data chunk's complete lines go out as ONE batch, the line held before
    // them first and the chunk's last complete line held in its place, so a chunk costs one windowed redaction, not one per line.
    const onOut = safe((d) => {
      buf += d;
      const cut = buf.lastIndexOf('\n');
      if (cut === -1) return;
      const lines = buf.slice(0, cut).split('\n');
      buf = buf.slice(cut + 1);
      const last = lines.pop();
      if (held !== null) lines.unshift(held);
      if (lines.length > 0) emit(lines.join('\n'), false);
      held = last;
    });
```

`take` stays: `onClose` still uses it for a partial last line.

(b) In `runOpVerb`, replace its last line

```js
  return opRelay(P, map.op, map.opArgs, (line, toStderr) => emit(redactFinalLines(line, idx), toStderr));
```

with

```js
  // D-5747 (history-relay-lookbehind-window): one look-behind per SOURCE stream, keyed by the shim's stream that opRelay
  // names (`fromStderr`), never by where operatorMain writes it: under --json both go to stderr, unordered between themselves.
  // Every ending (onClose, fail(), the signal handlers) writes through this one callback, so through its window.
  const behind = { out: '', err: '' };
  return opRelay(P, map.op, map.opArgs, (text, fromStderr) => {
    const k = fromStderr ? 'err' : 'out';
    const r = healthLib.redactAfter(behind[k], text, idx);
    behind[k] = r.keep;
    emit(r.emit, fromStderr);
  });
```

`healthLib` is `cli.mjs`'s namespace import of `./lib.mjs` (`:44`). `redactFinalLines` stays in the named import list, because `errLine` and `emitRefusal` still use it.

(c) The comments that describe the relay. Each replacement is one block, matched once.

In the operator door's header comment, replace

```js
//      and stderr are piped. stdout is relayed line by line as it arrives (an import's dry run can list thousands of
//      files), each line through redactFinalLines with the read verbs' index (D-5022, review 441 F10; spec §9.8:
//      redacted on every output). stderr is HELD and redacted as ONE text, as errLine redacts a thrown message, so a
//      shape that spans lines (a PEM body, a JSON value on the line after its key) is masked whole; it is written when
//      the child ends, before the CLI's own last line (opRelay's header names the endings and the cap). Its LAST stdout
//      line, the sweep's `{"rc":…}`, is held back for
```

with

```js
//      and stderr are piped. stdout is relayed as it arrives (an import's dry run can list thousands of files), each
//      read's whole lines as one batch, redacted with the read verbs' index (D-5022, review 441 F10; spec §9.8:
//      redacted on every output). stderr is HELD and redacted as ONE text, as errLine redacts a thrown message; it is
//      written when the child ends, before the CLI's own last line (opRelay's header names the endings and the cap).
//      Every text either stream relays is redacted with the last RELAY_LOOKBEHIND_BYTES its own stream wrote before it
//      (lib redactAfter, D-5747), so a shape that spans lines (a PEM body, a JSON value on the line after its key) is
//      masked whole when its head went out in an earlier batch or before the stderr spill. Its LAST stdout
//      line, the sweep's `{"rc":…}`, is held back for
```

Replace `ERR_HOLD_CAP`'s doc comment

```js
/** What the relay holds of the shim's stderr before it writes some (D-5022): 1 MiB of bytes. Under it the held text is
 *  redacted as one text when the child ends. Past it, the text up to its LAST line boundary is redacted and written, and
 *  the rest is held on. A held stretch with NO line break past the cap is written where the over-cap read ended, mid-line, and
 *  emit adds a newline there: the seam falls at that read, not exactly at the cap, and one line break is ADDED (no byte is
 *  dropped). The only residual is a shape that is split across that seam, which no pass on either side can see whole. */
```

with

```js
/** What the relay holds of the shim's stderr before it writes some (D-5022): 1 MiB of bytes. Under it the held text is
 *  redacted as one text when the child ends. Past it, the text up to its LAST line boundary is redacted and written, and
 *  the rest is held on. A held stretch with NO line break past the cap is written where the over-cap read ended, mid-line, and
 *  emit adds a newline there: the seam falls at that read, not exactly at the cap, and one line break is ADDED (no byte is
 *  dropped). The text after the seam is read with stderr's look-behind (D-5747), so a shape split across the seam is masked
 *  when its head lies within RELAY_LOOKBEHIND_BYTES of it; the residual is a longer shape. The look-behind joins the two sides
 *  at a line break, as the output shows them, so a value cut by a mid-line seam is read as two lines. */
```

Replace the first four lines of `opRelay`'s doc comment

```js
/** The shim as a child: its stdout relayed line by line as it arrives, its LAST stdout line held back for the relay;
 *  its stderr HELD and redacted as one text (D-5022, review 441 F10 and coordinator ruling 5020: a per-line redaction
 *  cannot see a PEM body after its BEGIN line, or a JSON value on the line after its key, which errLine's whole-text
 *  pass masks). `emit(text, true)` is the held stderr text, without its last line break (emit adds one). The held text
```

with

```js
/** The shim as a child: its stdout relayed as it arrives, each read's whole lines as one batch (D-5747), its LAST stdout
 *  line held back for the relay; its stderr HELD and redacted as one text (D-5022, review 441 F10 and coordinator ruling
 *  5020: a per-line redaction cannot see a PEM body after its BEGIN line, or a JSON value on the line after its key, which
 *  errLine's whole-text pass masks). `emit(text, false)` is a batch of stdout lines and `emit(text, true)` the held stderr
 *  text, each without its last line break (emit adds one); the second argument names the SOURCE stream, which is what
 *  runOpVerb keys each stream's look-behind by (D-5747). The held text
```

Replace `runOpVerb`'s doc comment

```js
/** One operator verb through the door. `emit(line, toStderr)` gets each line the sweep printed before its result on
 *  stdout, and the text it printed on stderr, held and written whole (`toStderr` true; D-5022), already through
 *  redactFinalLines with relayIndexOf's index, which is built only once the gate has passed, before the shim starts. */
```

with

```js
/** One operator verb through the door. `emit(text, toStderr)` gets the lines the sweep printed before its result on
 *  stdout, a read's whole lines at a time, and the text it printed on stderr, held and written whole (`toStderr` true;
 *  D-5022), already redacted with relayIndexOf's index, which is built only once the gate has passed, before the shim
 *  starts, and with the look-behind of the stream the text came from (lib redactAfter, D-5747). */
```

In `operatorMain`'s doc comment, replace the two lines

```js
 *  Under --json, stdout is the envelope alone and the sweep's lines go to stderr; every relayed line arrives here
 *  already through redactFinalLines (runOpVerb's relayIndexOf). */
```

with

```js
 *  Under --json, stdout is the envelope alone and the sweep's lines go to stderr; every relayed text arrives here
 *  already redacted (runOpVerb's relayIndexOf, through its stream's look-behind, D-5747). */
```

Then check: `node --check ccd/history/cli.mjs` prints nothing, and `grep -c 'process.stderr.write(' ccd/history/cli.mjs` still prints `9`, as at the base (this task adds no write; H-32 counts them).

- [ ] **Step 9: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5747')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'D-5022|O54|the relay redaction|D-5747')
```

Expected (measured on a copy of `bd363a76b` with Tasks 1, 2 and 3 applied):
- `7 passed`;
- history-cli `72 passed | 1 skipped`;
- the relay's neighbours `42 passed` (re-measured with R11's composed doors; `41` before the plan's second review added a case). These include the endings, the exact-cap pins on both sides, the F2 tables on both streams (one mark per case) and the closed-pipe cases; marks change no byte of non-secret text, so the cap pins' byte counts hold.

- [ ] **Step 10: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. Each filter selects only the case or cases its comment names: measured on a copy of `bd363a76b` with Tasks 1–3 applied, the lib filters select one case each (`1 failed | 1123 skipped`), M11's alternation selects three, and M15's lib filter three and its maint filter two. The plan's earlier M14 and M16 measured the JSON-form key rule, which the coordinator withdrew (R10, R11); they are gone, and their names are not reused.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h2/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"

# M1: the standalone pass dropped (the context reading over the raw batch). With the union in place this case's batch is one
# line, which the per-line reading masks, so M1 alone is GREEN on it (measured at the plan's second review): the guard is measured
# with the union dropped too (M15's line), which is the relay this guard was first measured on.
mut ccd/history/lib.mjs '  const R = redactFinalLines(`${lookBehind}\n${alone}`, idx);' '  const R = redactFinalLines(`${lookBehind}\n${text}`, idx);'
mut ccd/history/lib.mjs '  return { emit: relayUnion(emit, perLine), keep };' '  return { emit, keep };'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'never less masked than the batch read alone')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): the batch read alone first keeps its mark: expected '[redacted]hunter2xyz' to be '[redacted]'.

# M2: the window one byte wider.
mut ccd/history/lib.mjs 'export const RELAY_LOOKBEHIND_BYTES = 16384;' 'export const RELAY_LOOKBEHIND_BYTES = 16385;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'starts exactly RELAY_LOOKBEHIND_BYTES back')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): one byte further: the residual, a shape longer than the window: expected 'zqx26 after' to be 'MIIBVgIB…'.

# M3: the window one byte narrower.
mut ccd/history/lib.mjs 'export const RELAY_LOOKBEHIND_BYTES = 16384;' 'export const RELAY_LOOKBEHIND_BYTES = 16383;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'starts exactly RELAY_LOOKBEHIND_BYTES back')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): in reach: the body is masked: expected 'MIIBVgIB…' to be 'zqx26 after'.

# M4: no crossing branch (the batch's part always cut at P's length).
mut ccd/history/lib.mjs '  if (R.startsWith(head)) return { emit: R.slice(head.length), keep };' '  return { emit: R.slice(head.length), keep };'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs from the look-behind into the batch')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured at the plan's second review, with the union): expected '[redacted]\nzqx26 ok' to be '[redacted]"}\nzqx26 ok'
# (without the union it was 'acted]"}\nzqx26 ok': the union masks the cut mark's tail, which the per-line reading never writes).

# M5: the window not carried (keep always empty).
mut ccd/history/lib.mjs "  const keep = relayKeep(lookBehind === '' ? text : \`\${lookBehind}\n\${text}\`);" "  const keep = '';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'carried from batch to batch by keep')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): a body line is one mark: expected 'MIIBVgIB…' to be '[redacted]'.

# M6: keep not cut at a line start.
mut ccd/history/lib.mjs '  return nl === -1 ? tail : tail.slice(nl + 1);' '  return tail;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'keep: at most RELAY_LOOKBEHIND_BYTES bytes')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): the longest run of whole lines that fits: expected 'LLLL…\n038LLLL…' to be '038LLLL…'.

# M7: a line longer than the window keeps nothing.
mut ccd/history/lib.mjs '  return nl === -1 ? tail : tail.slice(nl + 1);' "  return nl === -1 ? '' : tail.slice(nl + 1);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'keep: at most RELAY_LOOKBEHIND_BYTES bytes')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): one line longer than the window: its last bytes, from a whole character: expected '' to be 'éééé…'.

# M8: the cut may fall inside a character.
mut ccd/history/lib.mjs '  while (at < enc.length && (enc[at] & 0xc0) === 0x80) at += 1;
' ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'keep: at most RELAY_LOOKBEHIND_BYTES bytes')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected '<U+FFFD>éééé…' to be 'éééé…x'.

# M9: a window that starts exactly at a line start loses that line.
mut ccd/history/lib.mjs "  if (at > 0 ? enc[at - 1] === 0x0a : raw[from - 1] === '\n') return tail;
" ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'starts exactly RELAY_LOOKBEHIND_BYTES back')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): in reach: the body is masked: expected 'MIIBVgIB…' to be 'zqx26 after'.

# M10: stdout back to one redaction per line, with no window (D-5022's shape).
mut ccd/history/cli.mjs "    const r = healthLib.redactAfter(behind[k], text, idx);" "    const r = fromStderr ? healthLib.redactAfter(behind[k], text, idx) : { emit: text.split('\n').map((l) => redactFinalLines(l, idx)).join('\n'), keep: '' };"
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'stdout, reach the terminal masked, in order')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): human stdout: the JSON value on the line after its key: expected 'zqx26 start\n{"password":\n  "hunter2…' not to contain 'hunter2…'.

# M11: the window not carried between texts (each text read alone, batching kept).
mut ccd/history/cli.mjs "    behind[k] = r.keep;" "    behind[k] = '';"
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'in SEPARATE writes are masked by the window|just before the stderr spill seam')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): 3 failed. Both split cases: the PEM body, written after its BEGIN line had been relayed: expected
# 'zqx26 start\n[redacted]\nMIIBVgIBADAN…' not to contain 'MIIB'. The spill case: the value after the seam: expected
# 'zqx26 yyyy…' not to contain 'hunter2…'.

# M12: one window for both streams (what keying by destination is under --json).
mut ccd/history/cli.mjs "    const k = fromStderr ? 'err' : 'out';" "    const k = 'out';"
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'keyed by the shim')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): human: the stderr line arrives as written: expected '[redacted]\n' to be 'zqx26 err plain line\n'.

# M13: a second declaration of the window, outside lib.mjs.
mut ccd/history/cli.mjs "const ERR_HOLD_CAP = 1 << 20;" "const ERR_HOLD_CAP = 1 << 20;
const RELAY_LOOKBEHIND_BYTES = 1;"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RELAY_LOOKBEHIND_BYTES')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): RELAY_LOOKBEHIND_BYTES: a second declaration: expected [ 'ccd/history/cli.mjs', …(1) ] to deeply
# equal [ 'ccd/history/lib.mjs' ]. Without Step 5's VOCABS entry the same mutant leaves 'ccrc history' green (92 passed).

# M15 (R4's fallback): the union dropped, so the window's reading is written as it is.
mut ccd/history/lib.mjs '  return { emit: relayUnion(emit, perLine), keep };' '  return { emit, keep };'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs into the next line|every value a line read alone masks|review finding 11')
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'runs into the next line|review finding 11')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): lib `3 failed`: `in one batch: expected 'zqx26 start\n{"token":\n"[redacted]":…' to be
# 'zqx26 start\n{"token":\n"[redacted]\n…'` (the window's reading takes "password" as token's value and prints the value),
# `expected 'zqx26 [redacted]hunter2xyz' to be 'zqx26 [redacted]'` and the property case, `1720 of 47939: expected [ …(5) ] to
# deeply equal []`. maint `2 failed`: `human stdout: the value: expected 'zqx26 start\n{"token":\n"[redacted]":…' not to contain
# 'hunter2…'` and `human stdout: the value glued after END, whose NAME the PEM mark took in: expected 'zqx26 start\nzqx26
# [redacted]hunter2…' not to contain 'hunter2…'`.

# M17 (the plan's third review): the union's line bound dropped, so a piece after a mark may lie on any later line.
mut ccd/history/lib.mjs '    const hi = open ? lines.length - 1 - breaksLeft : lo;' '    const hi = lines.length - 1;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs into the next line')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): the lines up to a later occurrence are written: expected 'zqx26 [redacted]done\n[redacted]\n[re…' to be
# 'zqx26 [redacted]\nfile a.md ok\nfile …'.

# M18 (the plan's third review): a piece that ends its line matched anywhere in a line, not only at its end.
mut ccd/history/lib.mjs '      if (endsLine) return s.length - piece.length >= from && s.endsWith(piece) ? s.length - piece.length : -1;
' ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs into the next line')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): not inside a longer word: expected 'zqx26 [redacted]hunter2xyz\n[redacted…' to be
# 'zqx26 [redacted]\nhunter2xyzzy.log\nz…'.

# M17 and M18 together (the union as first written looked for a piece anywhere later): the first new pin reds.
mut ccd/history/lib.mjs '    const hi = open ? lines.length - 1 - breaksLeft : lo;' '    const hi = lines.length - 1;'
mut ccd/history/lib.mjs '      if (endsLine) return s.length - piece.length >= from && s.endsWith(piece) ? s.length - piece.length : -1;
' ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs into the next line')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): the same characters at the start of a later line: expected 'zqx26 [redacted]hunter2xyz\n[redacted]' to be
# 'zqx26 [redacted]\nhunter2xyzzy.log'.

# M19 (the plan's third review): the union's reach bound dropped, so a piece not found is looked for on every line it may lie on.
mut ccd/history/lib.mjs 'k === -1 && L + 1 < hi && reach <= RELAY_LOOKBEHIND_BYTES; )' 'k === -1 && L + 1 < hi; )'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'runs into the next line')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured, about 90 s): 8 MiB: expected 90568 to be less than 30000. The ceiling is 30 s; the case's own timeout is 300 s.

git diff --stat -- ccd/history   # lib.mjs, lib.d.mts and cli.mjs show only this task's edits
```

Then run Step 4's first command and Step 9's commands once more: green.

- [ ] **Step 11: Amend the spec.** In `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, §8.4's bullet "**Every writing form runs `"$HOME/.local/bin/ccd-history-sweep" --op <verb> …` as a child and waits**", replace the one sentence

```
The CLI relays stdout line by line as it arrives, through the output redaction of §8.3, and holds stderr and redacts it as one text when the child ends (bounded at 1 MiB, written on every ending), so a shape that spans lines is masked whole (D-5022).
```

with

```
The CLI relays stdout as it arrives, each read's whole lines as one batch, and holds stderr and redacts it as one text when the child ends (bounded at 1 MiB, written on every ending) (D-5022). Every text either stream relays goes through the output redaction of §8.3 together with the last 16 KiB its own stream wrote before it (`RELAY_LOOKBEHIND_BYTES`), read alone first so that it is never less masked than that batch alone, so a shape that spans lines is masked whole even when its head went out in an earlier batch or before the stderr spill (D-5747). Each batch's reading is unioned with the batch read one line at a time, as the per-line relay before it read stdout: a piece the per-line reading does not print, on a line the reading's line breaks allow, is written as a mark (D-5747), so a value a line read alone masks is written only where another line of the same batch, read alone, prints the same characters. That per-line reading is this build's §8.3 redaction, which reads the widened rules only over the narrower path's output, so it masks every value the build before it masked; a JSON key's next-line pair in one batch, which the batch read as one text takes as the key's value, is written as one mark from the key on. The residuals are a shape longer than that window, and a key at the end of a line longer than the window that a shorter line follows in its batch; text already written before its key line, which no later pass can take back; a value cut exactly at a mid-line stderr seam, which is read as two lines; the window's raw text, kept in process memory as the held stderr already is; on stdout, a BEGIN line with no END masks the stream's next 16 KiB of output, which then reads as marks; and the union's: characters matched on another line that prints them are written beside a mark while that line becomes one, and a piece the union cannot place is a mark (a line can lose words beside a masked value; and where a line only the joined reading of §8.3 masks, such as a NAME a colour sequence splits, the batch's reading removes every escape sequence, so every coloured line of that batch, and of later batches while that line is in the window, is a mark).
```

Measured: no test reads this sentence; `grep -rn 'relays stdout line by line' server/test ccd` finds nothing. The line count of the spec does not change, so no line citation moves.

- [ ] **Step 12: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
```

Expected: green. Measured on a copy of `bd363a76b` with Tasks 1, 2 and 3 applied:
- history-lib `1124 passed` (1083, 6, 23 and 12; about 107 s);
- history-maint `126 passed` (the base's 118, Task 2's 1 and this task's 7; about 119 s);
- history-cli `72 passed | 1 skipped`;
- single-definition `93 passed`;
- history-recover `139 passed`. At the plan's second review, in one run alongside the other suites, its case "each refusal answers restore-refused and writes nothing; …" went red once; it was green alone and on a full re-run of the file. Treat a red there as a load flake to re-run alone, as CLAUDE.md says;
- history-export `84 passed` and history-skill `25 passed`;
- ccrc-doctor `-t history` `123 passed`.

The last four files run the CLI's operator door or doctor on fixture HOMEs. Their relayed lines carry no secret, so the batching changes no byte they read. On this plan's tree each count also holds Tasks 1 and 2's cases and 5h-1's.

- [ ] **Step 13: Commit.** D-5747's entry is already in "Deviations found" (it came with the plan): check that `grep -c '^- \*\*D-5747\*\* — ' docs/superpowers/plans/2026-10-19-ccrc-history-w5h2-redaction-and-ops.md` prints 1, and never add a second. If a figure this task measured differs from the entry's, correct the entry in this commit and add the plan file to `git add`.

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs \
  docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md \
  server/test/history-lib.test.ts server/test/history-maint.test.ts server/test/history-cli.test.ts server/test/single-definition.test.ts
git commit -m "fix(history): the operator relay reads each shim stream through a 16 KiB look-behind, so a shape split across lines, reads or the stderr spill is masked (W5h-2 Task 3, D-5747)"
```

---

### Task 4: an op marker names its process

The op marker `~/.ccrc/history/op` holds `<verb> <pid> <start_ms>` and nothing that identifies the process. Its liveness is `kill(pid, 0)` with EPERM read as alive, in two copies of `pidAlive`: `cli.mjs`'s (status's `env.op.alive`) and `sweep.mjs`'s (`removeStaleOpMarker`). So a marker left behind a REUSED pid reads as a live operator pass. `deriveHealth`'s `opLive` then holds back D-5026's death line and every freshness FAIL `stateHeld` gates, and adds a false `op-running` WARN, until that pid is freed or the next operator pass removes the marker. This is D-5026's residual (i), recorded with no number; B2's ledger item 3 owes the fix. The scope measured it on a fixture HOME with the base's own `removeStaleOpMarker`: a marker naming pid 1 (EPERM) is kept, a marker naming a live unrelated pid is kept, and only an exited pid's marker is removed.

This task gives the op marker D-5016's process identity, measured the way D-5016 measures the pass marker's (`procIdentityOf`, `procStartOf`, `bootIdOf`, `decidePassLive`; nothing is re-implemented). Coordinator ruling R5 decides the rest:
- The marker has five fields: `<verb> <pid> <start_ms> <proc_start> <boot_id>`, written by `formatOpMarker` and read by `parseOpMarker`.
- An identity-bearing marker is live only when BOTH `procStart` and `bootId` measured now equal the marker's. A mismatch, or an identity that cannot be measured, is never retried by the kill probe.
- A legacy three-field marker parses, with `procStart` and `bootId` null, and is live only when `kill(pid, 0)` answers ok. EPERM reads as NOT live, because the fleet runs as one UNIX user.
- `decideOpLive(marker, measured)` is the one rule, read by `removeStaleOpMarker` and by status's `op.alive`. Both `pidAlive` copies and the dead `readOpMarker` go.

**The rollout window.** An `--op` pass (an adopt, restore, rebuild or backfill) of the build before this one, still running across `ccrc update`, leaves a three-field marker. This build reads it as legacy: live while its pid answers the kill probe. So the pass keeps holding the freshness FAILs back as it did, and the update's doctor does not exit 3 on a `tick-stale` it would otherwise show. A legacy marker keeps the reused-pid weakness until the next operator pass of this build replaces it.

The same task carries B2's erratum (item 5 (c), review 467 F4): the pass marker's "at most 87 B" is 86 B. That bound and the op marker's new one (at most 119 B) are one edit to the same `shared/lifecycle.ts` tier and the same spec §9.4 row. The erratum needs no number. The departure is **D-5748** (`history-op-marker-identity`).

**Files:** (anchors measured at `bd363a76b`; re-anchor each by its quoted content.)
- Modify: `ccd/history/lib.mjs`:
  - `parseOpMarker` and its doc comment, which begins `/** The op marker's one grammar (§9.6 op-running; Task 25)` (`:3200-3205`), replaced; `formatOpMarker` and `decideOpLive` are inserted directly after it, above `parsePassMarker`'s doc comment.
  - Not touched here: `deriveHealth`, `HEALTH_REMEDIES`, `remedyFor` and `HEALTH_WORDS`. Wave 5h-1 and this plan's Task 5 edit those regions; `opLive` (`:3545`) keeps reading `h.op.alive`.
- Modify: `ccd/history/lib.d.mts`: the one line `export function parseOpMarker(text: string): { verb: string; pid: number; startMs: number } | null;` (`:362`), replaced by the `OpMarker` and `OpMeasure` types and three declarations. Wave 5h-1 edits `HealthInputs` (`:403` region); this is a separate hunk.
- Modify: `ccd/history/sweep.mjs`:
  - the lib import's line that contains `decideOpGate, formOf, parseOpMarker, formatPassMarker,` (`:57`);
  - `pidAlive` (`:6172-6180`), `readOpMarker` (`:6182-6186`), `removeStaleOpMarker` (`:6188-6195`) and `writeOpMarker` (`:6197-6200`): one contiguous block, replaced. It sits directly after `paneNameFor` and above `projectsRootOf`, above the R1 entry guard.
  - Not touched: `procIdentityOf` (`:3888`), which is reused as it stands, and the four `writeOpMarker` callers (`:3428`, `:6688`, `:7737`, `:7891`) and four `removeStaleOpMarker` callers (`:3427`, `:3791`, `:7736`, `:7890`), whose signatures do not change.
- Modify: `ccd/history/cli.mjs`:
  - the first lib import's line `  decideStatusReadFailure, RETENTION_STATE_META, decideGrepIndex, parsePassMarker, decidePassLive, parsePassDied,` (`:39`);
  - `function pidAlive(pid) {` and its body (`:147-154`), deleted;
  - `import { loadSecrets, procIdentityOf } from './sweep.mjs';` (`:63`);
  - in `boxFacts`, the line `  env.op = m === null ? null : { verb: m.verb, pid: m.pid, alive: pidAlive(m.pid), start_ms: m.startMs };` (`:206`): only `alive` changes; `start_ms` keeps reading `m.startMs`.
  - Wave 5h-1 edits `readStoreExtras` and `healthInputsOf`; this task touches neither.
- Modify: `shared/lifecycle.ts`: the `history-store-id` row's `tier` and one clause of its `ruling` (`:64-66`). It is L0 and imports nothing; the edit is string text only.
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`:
  - §9.4's `history-store-id` row (`:2162`): its tier cell and one clause of its ruling cell;
  - §9.6's `op-running` bullet (`:2245`).
  - Wave 5h-1 adds §9.6 rows for its export words; this bullet is a separate hunk.
- Modify: `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md`: one sentence appended to D-5016's entry (`:38286`, the erratum) and one to D-5026's entry (`:38296`, residual (i) closed). Both definitions stay as history.
- Test: `server/test/history-lib.test.ts`:
  - in `describe('lib: parseOpMarker (plan task 25)'` (`:3590`), the first case's two `expect` lines (`:3593-3594`);
  - one describe appended at the end of the file (after whatever the earlier tasks appended).
- Test: `server/test/history-op.test.ts`:
  - the lib import (`:20`);
  - in `describe('the op marker (§9.6)'` (`:990`), two helpers after its `dead` helper (`:992`), the first case's title and its marker regex (`:994`, `:1006-1007`), and two cases appended after the case that ends `'a live pid\'s marker is another pass\'s, and stands').toBe(live);` (`:1043`).
- Test: `server/test/history-cli.test.ts`: inside `describe('the pass marker (D-5016)'` (`:654`), two cases directly after the D-5026 case that ends with the planted-directory lines (`:851-854`). The describe's helpers `staleBox`, `plantDied`, `identityOf`, `failOf`, `statusOf` and `wordsOf` are reused.
- Test: `server/test/ccrc-doctor.test.ts`:
  - the history lib import (`:1395`);
  - a helper directly after `metaOnFreshTick` (`:14223-14226`);
  - two `STATES` rows directly after the row `'tick-stale: a dead pid\'s op marker holds nothing back'`, whose plant ends `` `prune ${dead} ${Date.now() - 2_400_000}\n` `` (`:14285-14286`).
  - Wave 5h-1 Task 2 adds `STATES` rows after `export-segment-missing`; this is a separate hunk.
- Test: `server/test/lifecycle.test.ts`: one import line directly after `import { LIFECYCLE } from '../../shared/lifecycle.js';` (`:15`), and one case directly after `it('declares history-store-id: …'`, which ends `expect(c!.ruling).toContain('the first pass that commits a tick removes pass-died');` (`:1151-1152`).
- Not edited:
  - `deriveHealth`. `opLive` keeps reading `h.op.alive`, which status now computes through `decideOpLive`. `HealthInputs.op` keeps its shape.
  - the status envelope. `op` stays `{ verb, pid, alive, start_ms }`, so there is no wire change.
  - `ccd/ccrc-doctor-checks`, `ccd/ccd`, `ccd/session-hook.sh` and `deploy/`.
  - `single-definition.test.ts`: no new vocabulary constant is declared.

**Interfaces:**
- Consumes (base, unchanged):
  - `lib.mjs`: `decidePassLive(marker: { procStart: string; bootId: string } | null, identityNow: ProcIdentity | null): boolean`, D-5016's identity test; `procStartOf(statText)` and `bootIdOf(text)`, which tests use to read `/proc` the way D-5016 does.
  - `sweep.mjs`: `procIdentityOf(pid): { procStart: string; bootId: string } | null`, which is null when either field cannot be measured (no `/proc`, a dead pid, a zombie).
  - `writeFileAtomic`, `readBounded`, `removeEntry` (store.mjs), and `CONTROL_FILE_MAX`.
- Produces:
  - `lib.mjs`: `parseOpMarker(text: string): { verb, pid, startMs, procStart, bootId } | null`. The start keeps its existing name, `startMs` (`lib.d.mts:362`, `history-lib.test.ts:3593-3594` and `cli.mjs:206` already use it), and `procStart` and `bootId` are null for a legacy three-field marker. The grammar is `^([a-z-]{1,32}) ([1-9][0-9]{0,9}) ([0-9]{1,16})(?: ([0-9]{1,20}) (<boot-id UUID>))?\s*$`, at most 119 B.
  - `lib.mjs`: `formatOpMarker({ verb, pid, startMs, procStart, bootId }): string`, newline-ended. It writes five fields when an identity is given and three when both identity fields are null, and throws a `TypeError` on half an identity.
  - `lib.mjs`: `decideOpLive(marker, measured): boolean`, where `measured` is `{ procStart: string | null, bootId: string | null, kill: 'ok' | 'esrch' | 'eperm' }`. A null marker answers false. A legacy marker answers `measured.kill === 'ok'`. An identity-bearing marker answers `decidePassLive(marker, identityNow)`, where `identityNow` is null unless both measured fields are strings; `kill` is never read for it.
  - `lib.d.mts`: `interface OpMarker`, `interface OpMeasure`, and declarations of `parseOpMarker`, `formatOpMarker` and `decideOpLive`, each exactly once.
  - `sweep.mjs`: `export function measureOpProcess(pid): { procStart, bootId, kill }`. It is `procIdentityOf(pid)`'s two fields, each null when unmeasurable, plus `kill(pid, 0)` as a word: `'ok'`, `'eperm'`, or `'esrch'` for ESRCH and for any other refusal (Node throws `ERR_INVALID_ARG_TYPE` for a pid above 2^31, which the 10-digit grammar admits).
  - `sweep.mjs`: `removeStaleOpMarker(P)` and `writeOpMarker(P, verb, nowMs)`, with their signatures unchanged. `writeOpMarker` still throws on a failed write (H-101).
  - `cli.mjs`: `env.op.alive = decideOpLive(m, measureOpProcess(m.pid))`; `env.op.start_ms` stays `m.startMs`, unchanged.

**Spec:** §9.6 `op-running` (`:2245`), §9.4's `history-store-id` row (`:2162`). The departure is D-5748 (`history-op-marker-identity`); its entry is already in "Deviations found", and Step 15 checks it. Related: D-5016 (the identity this reuses), D-5026's residuals (h) and (i), and coordinator ruling R5.

**Choices this task makes:**
- **The start field keeps its name, `startMs`** (coordinator ruling; the earlier shared name `ms` is withdrawn). `lib.d.mts:362`, `history-lib.test.ts:3593-3594` and `cli.mjs:206` already use it, so no reader is renamed and the envelope's `start_ms` is unchanged. The existing parse case is re-expected in Step 1 only to add `procStart` and `bootId`.
- **`measureOpProcess` lives in `sweep.mjs`, not lib.** It calls `process.kill` and reads `/proc` through `procIdentityOf`; lib is L1 and pure. `cli.mjs` imports it beside `procIdentityOf`, as it already imports that.
- **The identity test is kept under the lock too, and the removal stays conditional.** The shim is the one lock taker, but a marker found under the lock is NOT always stale: `adoptArm`, `restoreArm` and `rebuildArm` write their marker and then call `finishBind`, which opens the store, and `openStore` calls `removeStaleOpMarker` (sweep.mjs `:3380`, `:3791`). There the pass reads its OWN live marker, and only `decideOpLive`'s identity-equal answer (at the base, `pidAlive` of its own pid) keeps it; an unconditional removal would delete a running bind pass's marker mid-pass and drop `op-running` and the `stateHeld` hold for the rest of it. One rule for status and the lock path, as R5 says. Step 13's M14 pins the conditional.
- **No fallback to the kill probe for an identity-bearing marker**, whether it mismatches or cannot be measured now (R5). A box with no `/proc` writes the legacy form, so its own markers keep the kill probe (R5's writer arm, added by the coordinator on review finding 10). The shim is Linux-only by product shape, so this is a Darwin test box only.
- **The legacy rows stay as they were.** These stay green unchanged and are now the rollout pins:
  - history-op's `keeps one naming a live pid` (a three-field marker naming the test process);
  - history-cli's envelope case (`:477`, a dead pid read as `alive: false`);
  - ccrc-doctor's `op-running` and dead-pid rows (`:14275-14286`).
- **Residuals, named.**
  - (a) **PID namespace (D-5026's (h)).** A `status` run in another PID namespace than the operator pass cannot measure its identity, and reads a live marker as not live. `kill(pid, 0)` already had this exposure for the old marker, and D-5026's (h) already names it for `pass`.
  - (b) **Read, then measure.** Status reads the marker and then measures the pid, so an operator pass can end in between and read as not live. Once it has ended, its last tick IS stale (no tick runs under an op pass), so no second read is needed. This is not measured end to end.
  - (c) **Legacy markers keep the reused-pid weakness** for the rollout window only.
  - (d) **A rollback to a build before this one while an op pass of this build runs.** The older build's grammar refuses the five-field marker, so its status reads no op until the pass ends, and its doctor can FAIL `tick-stale` meanwhile. Nothing removes the marker under it, because removal runs under the lock the pass holds.
  - (e) **This build still writes the legacy form where it cannot measure an identity.** On a box where `procIdentityOf(process.pid)` answers null (no `/proc`: a Darwin test box, since the shim is Linux-only by product shape), `writeOpMarker` writes the three-field form, read by the kill probe. R5's row names this writer arm (added by the coordinator on review finding 10): removing legacy acceptance also retires it ("Not in this plan").

- [ ] **Step 1: Write the failing lib tests.** In `server/test/history-lib.test.ts`, inside `describe('lib: parseOpMarker (plan task 25)'`, replace the two lines

```ts
    expect(lib.parseOpMarker('import 4242 1700000000000\n')).toEqual({ verb: 'import', pid: 4242, startMs: 1700000000000 });
    expect(lib.parseOpMarker('migrate 1 0')).toEqual({ verb: 'migrate', pid: 1, startMs: 0 });
```

with

```ts
    // D-5748 (W5h-2 Task 4): the start keeps its name, startMs, and a three-field marker is a LEGACY one, with no identity.
    expect(lib.parseOpMarker('import 4242 1700000000000\n')).toEqual({ verb: 'import', pid: 4242, startMs: 1700000000000, procStart: null, bootId: null });
    expect(lib.parseOpMarker('migrate 1 0')).toEqual({ verb: 'migrate', pid: 1, startMs: 0, procStart: null, bootId: null });
```

Then append at the end of the file:

```ts

// ── W5h-2 Task 4: the op marker names its process (D-5748 (history-op-marker-identity)) ─────────────────────────
// The op marker gains D-5016's identity: `<verb> <pid> <start_ms> <proc_start> <boot_id>`, written by formatOpMarker and read
// by parseOpMarker, whose three-field form is a LEGACY marker (an operator pass of the older build, still running across
// `ccrc update`). decideOpLive is the one liveness rule: an identity-bearing marker is live only when the identity measured now
// equals it in both fields, with NO fallback to the kill probe; a legacy one is live only when `kill(pid, 0)` answers ok, EPERM
// reading as NOT live because the fleet is one UNIX user.
describe('lib: the op marker names its process (D-5748)', () => {
  const BOOT = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
  const OTHER_BOOT = '99999999-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

  it('formatOpMarker writes `<verb> <pid> <start_ms> <proc_start> <boot_id>` and parseOpMarker reads it back', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const text = lib.formatOpMarker({ verb: 'import', pid: 4242, startMs: 1700000000000, procStart: '987654', bootId: BOOT });
    expect(text).toBe(`import 4242 1700000000000 987654 ${BOOT}\n`);
    expect(lib.parseOpMarker(text)).toEqual({ verb: 'import', pid: 4242, startMs: 1700000000000, procStart: '987654', bootId: BOOT });
    expect(lib.parseOpMarker(`restore 7 0 0 ${BOOT}`)).toEqual({ verb: 'restore', pid: 7, startMs: 0, procStart: '0', bootId: BOOT });
  });

  it('a legacy three-field marker parses with procStart and bootId null; formatOpMarker writes one only when no identity was measured, and refuses half of one', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.parseOpMarker('prune 4242 1700000000000\n')).toEqual({ verb: 'prune', pid: 4242, startMs: 1700000000000, procStart: null, bootId: null });
    expect(lib.formatOpMarker({ verb: 'migrate', pid: 7, startMs: 0, procStart: null, bootId: null })).toBe('migrate 7 0\n');
    expect(() => lib.formatOpMarker({ verb: 'migrate', pid: 7, startMs: 0, procStart: '5', bootId: null })).toThrow(/both/);
    expect(() => lib.formatOpMarker({ verb: 'migrate', pid: 7, startMs: 0, procStart: null, bootId: BOOT })).toThrow(/both/);
  });

  it('parseOpMarker answers null for every other shape: four fields, a malformed or upper-case boot id, a long or signed proc_start, a sixth field, a second line', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    for (const bad of ['import 4242 1700000000000 987654', 'import 4242 1700000000000 987654 nope',
      `import 4242 1700000000000 ${'9'.repeat(21)} ${BOOT}`, `import 4242 1700000000000 -1 ${BOOT}`,
      `import 4242 1700000000000 987654 ${BOOT.toUpperCase()}`, `import 4242 1700000000000  987654 ${BOOT}`,
      `import 4242 1700000000000 987654 ${BOOT} extra`, `import 4242 1700000000000 987654 ${BOOT}\nimport 4243 1`,
      `4242 1700000000000 987654 ${BOOT}`]) {
      expect(lib.parseOpMarker(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('the longest marker the grammar takes is 119 B, and one more character in any field is refused', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const field = ['a'.repeat(32), '9'.repeat(10), '9'.repeat(16), '9'.repeat(20)];
    const line = (f: string[]): string => `${f.join(' ')} ${BOOT}\n`;
    expect(lib.parseOpMarker(line(field))).not.toBeNull();
    expect(Buffer.byteLength(line(field))).toBe(119);
    for (let i = 0; i < field.length; i += 1) {
      const longer = field.map((v, j) => (j === i ? `${v}${v[0]}` : v));
      expect(lib.parseOpMarker(line(longer)), `field ${i} one longer`).toBeNull();
    }
  });

  // decideOpLive's table: [what, marker procStart, marker bootId, measured procStart, measured bootId, kill, live]
  const ROWS: Array<[string, string | null, string | null, string | null, string | null, 'ok' | 'esrch' | 'eperm', boolean]> = [
    ['identity measured equal', '55555', BOOT, '55555', BOOT, 'ok', true],
    ['identity measured equal, whatever kill says', '55555', BOOT, '55555', BOOT, 'eperm', true],
    ['a reused pid: another start time, though kill answers ok', '55555', BOOT, '55556', BOOT, 'ok', false],
    ['another boot, though kill answers ok', '55555', BOOT, '55555', OTHER_BOOT, 'ok', false],
    ['an identity that cannot be measured now (no /proc, a dead pid, a zombie), though kill answers ok', '55555', BOOT, null, null, 'ok', false],
    ['legacy, kill answers ok', null, null, '55555', BOOT, 'ok', true],
    ['legacy, kill answers ok and no identity measures', null, null, null, null, 'ok', true],
    ['legacy, kill answers EPERM (another user\'s process; the fleet is one UNIX user)', null, null, null, null, 'eperm', false],
    ['legacy, kill answers ESRCH', null, null, null, null, 'esrch', false],
  ];
  it.each(ROWS)('decideOpLive: %s', async (_what, mStart, mBoot, nStart, nBoot, kill, live) => {
    const lib = await import('../../ccd/history/lib.mjs');
    const marker = { verb: 'import', pid: 4242, startMs: 1700000000000, procStart: mStart, bootId: mBoot };
    expect(lib.decideOpLive(marker, { procStart: nStart, bootId: nBoot, kill })).toBe(live);
  });

  it('decideOpLive: no marker is no live pass, whatever is measured', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.decideOpLive(null, { procStart: '55555', bootId: BOOT, kill: 'ok' })).toBe(false);
  });
});
```

The boot ids are synthetic UUIDs, and no fixture here is key-shaped.

- [ ] **Step 2: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5748|parseOpMarker')
```

The filter selects 16 tests: the two existing parse cases and this task's 14. Expected red (measured at `bd363a76b`): `14 failed | 2 passed`.
- The failures:
  - the re-expected parse case: `expected { verb: 'import', pid: 4242, …(1) } to deeply equal { verb: 'import', pid: 4242, …(3) }`;
  - the round trip: `TypeError: lib.formatOpMarker is not a function`;
  - the legacy case: the same deep-equal message, for `prune`;
  - the 119 B case: `expected null not to be null`;
  - the ten `decideOpLive` cases: `TypeError: lib.decideOpLive is not a function`.
- The two that pass:
  - the base's `rejects every other shape` case;
  - this task's `answers null for every other shape` case. The base grammar refuses every longer form, so it passes by construction. Its guard is mutant M6 in Step 13.

- [ ] **Step 3: Write the lib grammar and the decision.**

(a) In `ccd/history/lib.mjs`, replace the whole block

```js
/** The op marker's one grammar (§9.6 op-running; Task 25): `~/.ccrc/history/op` holds `<verb> <pid> <start_ms>`.
 *  Anything else is null, which a pass treats as stale (it names no live pid) and status reports as no op. */
export function parseOpMarker(text) {
  const m = /^([a-z-]{1,32}) ([1-9][0-9]{0,9}) ([0-9]{1,16})\s*$/.exec(text);
  return m === null ? null : { verb: m[1], pid: Number(m[2]), startMs: Number(m[3]) };
}
```

with

```js
/** The op marker's one grammar (§9.6 op-running; Task 25): `~/.ccrc/history/op` holds `<verb> <pid> <start_ms>
 *  <proc_start> <boot_id>` since D-5748 (history-op-marker-identity), the pass marker's identity (D-5016) after the verb, pid
 *  and start, so a reused pid or another boot never reads as the pass that wrote it. The three-field form `<verb> <pid>
 *  <start_ms>` is a LEGACY marker, left by an operator pass of the older build that is still running across `ccrc update`:
 *  it parses with `procStart` and `bootId` null, and decideOpLive reads it by the kill probe. At most 119 B (32 + 10 + 16 +
 *  20 + 36, four spaces and a newline). Anything else is null, which a pass treats as stale (it names no live pid) and status
 *  reports as no op. */
export function parseOpMarker(text) {
  const m = /^([a-z-]{1,32}) ([1-9][0-9]{0,9}) ([0-9]{1,16})(?: ([0-9]{1,20}) ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\s*$/.exec(text);
  return m === null ? null : { verb: m[1], pid: Number(m[2]), startMs: Number(m[3]), procStart: m[4] ?? null, bootId: m[5] ?? null };
}

/** The op marker's text (D-5748): the grammar above, newline-ended. Five fields when the writer measured its identity, the
 *  legacy three when it could not (no /proc: the shim is Linux-only, so this is a Darwin test box); half an identity is a
 *  writer's bug and throws. */
export function formatOpMarker({ verb, pid, startMs, procStart, bootId }) {
  const start = procStart ?? null;
  const boot = bootId ?? null;
  if ((start === null) !== (boot === null)) throw new TypeError('formatOpMarker: procStart and bootId are both measured or both null');
  return start === null ? `${verb} ${pid} ${startMs}\n` : `${verb} ${pid} ${startMs} ${start} ${boot}\n`;
}

/** Whether an op marker names an operator pass that is running now (D-5748): the one rule status's `op.alive` and the
 *  stale-marker removal both read. `measured` is what the caller measured of the marker's pid just now: its identity
 *  (`procStart` and `bootId`, both null when it cannot be measured) and `kill`, the answer of `kill(pid, 0)` as a word
 *  ('ok', 'esrch' or 'eperm'). An identity-bearing marker is live ONLY when the identity measured now equals it in both
 *  fields (decidePassLive), and a mismatch or an unmeasurable identity is never retried by the kill probe, which a reused
 *  pid answers. A legacy marker is live only when the kill probe answers 'ok': EPERM is another user's process, and the
 *  fleet runs as one UNIX user, so it is not ours. No marker is no live pass. */
export function decideOpLive(marker, measured) {
  if (marker === null || measured === null || measured === undefined) return false;
  if (marker.procStart === null || marker.bootId === null) return measured.kill === 'ok';
  const identityNow = measured.procStart === null || measured.bootId === null ? null : { procStart: measured.procStart, bootId: measured.bootId };
  return decidePassLive(marker, identityNow);
}
```

`decidePassLive` is a function declaration further down the file, so it is hoisted, and `decideOpLive` runs only after the module has loaded.

(b) In `ccd/history/lib.d.mts`, replace the one line

```ts
export function parseOpMarker(text: string): { verb: string; pid: number; startMs: number } | null;
```

with

```ts
/** D-5748: the op marker, `<verb> <pid> <start_ms> <proc_start> <boot_id>`; a legacy three-field marker has procStart and bootId null. */
export interface OpMarker { readonly verb: string; readonly pid: number; readonly startMs: number; readonly procStart: string | null; readonly bootId: string | null }
export function parseOpMarker(text: string): OpMarker | null;
export function formatOpMarker(marker: OpMarker): string;
/** D-5748: what the caller measured of an op marker's pid just now: its identity (both null when unmeasurable) and kill(pid, 0) as a word. */
export interface OpMeasure { readonly procStart: string | null; readonly bootId: string | null; readonly kill: 'ok' | 'esrch' | 'eperm' }
export function decideOpLive(marker: OpMarker | null, measured: OpMeasure | null): boolean;
```

Check: `grep -c 'export function parseOpMarker\|export function formatOpMarker\|export function decideOpLive\|export interface OpMarker\|export interface OpMeasure' ccd/history/lib.d.mts` prints 5. `skipLibCheck` hides a duplicate, so count them.

(c) `ccd/history/cli.mjs` is not edited in this step: `boxFacts` keeps reading `m.startMs`, whose name the widened parse keeps. Check: `grep -c 'start_ms: m.startMs };' ccd/history/cli.mjs` prints 1. `pidAlive` stays until Step 7. `grep -rn 'parseOpMarker(' ccd/history/*.mjs` names `lib.mjs`, `cli.mjs`'s `boxFacts` and `sweep.mjs`'s `readOpMarker` and `removeStaleOpMarker`; `readOpMarker` has no caller, and `removeStaleOpMarker` reads only `.pid`, so no reader of the parsed start changes.

- [ ] **Step 4: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5748|parseOpMarker')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
```

Expected green (measured at `bd363a76b` with this task alone): `16 passed`; then the whole file `1097 passed`, the base's 1083 plus this task's 14. On this plan's tree it is the count after Tasks 1–3, plus 14.

- [ ] **Step 5: Write the failing delivery tests.** Three files.

(a) `server/test/history-op.test.ts`. In the lib import line, replace

```ts
import { WRITING_FORMS, CARRIER_KILL_S, SCHEMA_VERSION, journalRecord, floorThreshold, historyPaths } from '../../ccd/history/lib.mjs';
```

with

```ts
import { WRITING_FORMS, CARRIER_KILL_S, SCHEMA_VERSION, journalRecord, floorThreshold, historyPaths, procStartOf, bootIdOf } from '../../ccd/history/lib.mjs';
```

In `describe('the op marker (§9.6)'`, replace the `dead` helper's line and the first case's title line

```ts
  const dead = (pid: number): boolean => { try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };

  it('an --op pass writes `<verb> <pid> <start_ms>` once it holds the lock; a scheduled pass then removes it, the pass being dead', () => {
```

with

```ts
  const dead = (pid: number): boolean => { try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };
  /** D-5748: a process's identity read from /proc the way D-5016 reads it (field 22 of its stat, and the boot id). */
  const bootNow = (): string => bootIdOf(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'))!;
  const identityOf = (pid: number): { procStart: string; bootId: string } => {
    const procStart = procStartOf(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (procStart === null) throw new Error(`no /proc identity for pid ${pid}`);
    return { procStart, bootId: bootNow() };
  };

  it('an --op pass writes `<verb> <pid> <start_ms> <proc_start> <boot_id>` once it holds the lock; a scheduled pass then removes it, the pass being dead (D-5748)', () => {
```

In the same case, replace the two lines

```ts
    const m = /^import ([1-9][0-9]*) ([0-9]+)\n$/.exec(text);
    expect(m, JSON.stringify(text)).not.toBeNull();
```

with

```ts
    const m = /^import ([1-9][0-9]*) ([0-9]+) ([0-9]{1,20}) ([0-9a-f-]{36})\n$/.exec(text);
    expect(m, JSON.stringify(text)).not.toBeNull();
    expect(m![4], 'D-5748: the boot id is this box\'s, measured now').toBe(bootNow());
```

The case's `dead(Number(m![1]))` assertion and the scheduled pass's removal stay as they are. The killed pass's identity no longer measures, so the next pass removes its marker under the new rule too.

Then, directly after the line

```ts
    expect(fs.readFileSync(opFile(box), 'utf8'), 'a live pid\'s marker is another pass\'s, and stands').toBe(live);
  });
```

insert

```ts

  // D-5748 (history-op-marker-identity): a marker that names its process is live only when the identity measured now equals it,
  // so a reused pid or another boot is stale whatever kill(pid, 0) says; the legacy three-field marker above keeps the kill probe.
  it('D-5748: a scheduled pass keeps a marker whose identity measures equal, and removes one naming a live pid with another start time or another boot', () => {
    const box = boundBox('ccrc-hist-opm-d-');
    const me = identityOf(process.pid);
    const OTHER_BOOT = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
    expect(me.bootId, 'CONTROL: the fixture boot id is not this box\'s').not.toBe(OTHER_BOOT);
    const own = `migrate ${process.pid} 1700000000000 ${me.procStart} ${me.bootId}\n`;
    fs.writeFileSync(opFile(box), own);
    expect(runSweep(box).code).toBe(0);
    expect(fs.readFileSync(opFile(box), 'utf8'), 'CONTROL: the identity measured equal is a live pass, and its marker stands').toBe(own);
    for (const [what, text] of [
      ['a live pid with another start time (a reused pid)', `migrate ${process.pid} 1700000000000 ${String(Number(me.procStart) + 1)} ${me.bootId}\n`],
      ['a live pid recorded under another boot', `migrate ${process.pid} 1700000000000 ${me.procStart} ${OTHER_BOOT}\n`],
    ] as const) {
      fs.writeFileSync(opFile(box), text);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(fs.existsSync(opFile(box)), `${what}: the marker is stale, and the pass removes it`).toBe(false);
    }
  });

  it.skipIf(process.getuid?.() === 0)('D-5748: a legacy marker naming a pid this user may not signal (kill answers EPERM) is stale, and a scheduled pass removes it', () => {
    const box = boundBox('ccrc-hist-opm-e-');
    expect(() => process.kill(1, 0), 'CONTROL: pid 1 is another user\'s process here').toThrow(/EPERM/);
    fs.writeFileSync(opFile(box), 'import 1 1700000000000\n');
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(opFile(box)), 'EPERM is not ours: the fleet is one UNIX user').toBe(false);
  });
```

The EPERM case is skipped only for a root-run suite, where `kill(1, 0)` succeeds and the premise does not exist. Its CONTROL line fails loudly on any other box where pid 1 can be signalled.

(b) `server/test/history-cli.test.ts`. Inside `describe('the pass marker (D-5016)'`, directly after the D-5026 case's last lines

```ts
      healthFs.mkdirSync(diedFile(box), { mode: 0o700 });                                       // a planted directory is not "absent" either
      const dir = statusOf(box);
      expect(dir.env!['pass_died']).toBe('unmeasured');
      expect(wordsOf(failOf(dir))).toEqual(['status-unreadable']);
    });
```

insert

```ts

    // W5h-2 Task 4 (D-5748 (history-op-marker-identity)): the op marker names its process as the pass marker does, and status's
    // op.alive is lib's decideOpLive over what it measures now. A marker behind a reused pid (D-5026's residual (i)) no longer reads
    // as a live operator pass, so it holds back neither the death line nor the freshness FAILs; a legacy three-field marker, from a
    // pass of the older build, is read by the kill probe, with EPERM not live.
    const opFile = (box: healthHh.HistoryBox): string => healthPath.join(box.home, '.ccrc', 'history', 'op');
    const plantOp = (box: healthHh.HistoryBox, text: string): void => {
      healthFs.mkdirSync(healthPath.dirname(opFile(box)), { recursive: true, mode: 0o700 });
      healthFs.writeFileSync(opFile(box), text, { mode: 0o600 });
    };
    it('(D-5748) an op marker naming a live pid with another start time (a reused pid) is op.alive false: no op-running WARN, and the death line it hid FAILs tick-stale', () => {
      const box = staleBox('ccrc-history-op-reused-');
      plantDied(box, 20 * MIN);
      const me = identityOf(process.pid);
      const start = Date.now() - 30 * MIN;
      plantOp(box, `prune ${process.pid} ${start} ${me.procStart} ${me.bootId}\n`);
      const held = statusOf(box);
      expect(held.env!['op'], 'CONTROL: the identity measured equal is a live operator pass').toEqual({ verb: 'prune', pid: process.pid, alive: true, start_ms: start });
      expect(wordsOf(held.env!['health']['warn'])).toContain('op-running');
      expect(wordsOf(failOf(held)), 'CONTROL: a live operator pass holds the death line back (D-5026, batch A2)').toEqual([]);
      plantOp(box, `prune ${process.pid} ${start} ${String(Number(me.procStart) + 1)} ${me.bootId}\n`);
      const r = statusOf(box);
      expect(r.env!['op']).toEqual({ verb: 'prune', pid: process.pid, alive: false, start_ms: start });
      expect(wordsOf(r.env!['health']['warn'])).not.toContain('op-running');
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
      expect(failOf(r)[0]!.detail).toContain('ended without writing a tick');
    });
    it.skipIf(process.getuid?.() === 0)('(D-5748) a legacy three-field op marker is read by the kill probe: this test\'s own pid is live, and pid 1, which this user may not signal, is not', () => {
      const box = staleBox('ccrc-history-op-legacy-');
      plantOp(box, `prune ${process.pid} 1700000000000\n`);
      const own = statusOf(box);
      expect(own.env!['op'], 'the rollout window: an older build\'s pass reads live').toEqual({ verb: 'prune', pid: process.pid, alive: true, start_ms: 1700000000000 });
      expect(wordsOf(failOf(own))).toEqual([]);
      expect(() => process.kill(1, 0), 'CONTROL: pid 1 is another user\'s process here').toThrow(/EPERM/);
      plantOp(box, 'prune 1 1700000000000\n');
      const r = statusOf(box);
      expect(r.env!['op']).toEqual({ verb: 'prune', pid: 1, alive: false, start_ms: 1700000000000 });
      expect(wordsOf(failOf(r))).toEqual(['tick-stale']);
    });
```

`staleBox` gives a 40-minute-old tick with lag measured now. `plantDied(box, 20 * MIN)` plants an open death, started after that tick. So, with no live operator pass, the D-5026 death line is the one `tick-stale` FAIL.

(c) `server/test/ccrc-doctor.test.ts`. Replace the history lib import line

```ts
import { HEALTH_COUNTERS, HEALTH_META, HEALTH_WORDS, RECOVERY_STALL_TICKS, SCHEMA_VERSION, deriveHealth, historyPaths } from '../../ccd/history/lib.mjs';
```

with

```ts
import { HEALTH_COUNTERS, HEALTH_META, HEALTH_WORDS, RECOVERY_STALL_TICKS, SCHEMA_VERSION, deriveHealth, historyPaths, formatOpMarker, procStartOf, bootIdOf } from '../../ccd/history/lib.mjs';
```

In `describeLinux('ccrc doctor: history — a real store, state by state …'`, directly after

```ts
  const metaOnFreshTick = (k: string, v: string): ((db: DatabaseSync) => void) => (db) => {
    freshTick(db);
    setHistoryMeta(db, k, v);
  };
```

insert

```ts
  /** D-5748: this test process's identity, read from /proc as D-5016 reads it, for an op marker that names its process. */
  const ownIdentity = (): { procStart: string; bootId: string } => {
    const procStart = procStartOf(readFileSync(`/proc/${process.pid}/stat`, 'utf8'));
    const bootId = bootIdOf(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
    if (procStart === null || bootId === null) throw new Error('this box has no /proc identity');
    return { procStart, bootId };
  };
```

and in `STATES`, directly after the dead-pid row's last two lines

```ts
        writeFileSync(join(historyRoot(home), 'op'), `prune ${dead} ${Date.now() - 2_400_000}\n`, { mode: 0o600 });
      } },
```

insert

```ts
    // W5h-2 Task 4 (D-5748): the op marker names its process; the two rows above plant the legacy three-field form an older build writes.
    { name: 'D-5748: an op marker whose identity measures equal is a live operator pass, a WARN and never the stale-tick FAIL', word: 'op-running', cls: 'WARN',
      plant: (home) => {
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'), formatOpMarker({ verb: 'prune', pid: process.pid, startMs: Date.now() - 2_400_000, ...ownIdentity() }), { mode: 0o600 });
      },
      absent: ['FAIL history: tick-stale'] },
    { name: 'D-5748: an op marker naming a live pid with another start time (a reused pid) holds nothing back', word: 'tick-stale', cls: 'FAIL',
      plant: (home) => {
        const me = ownIdentity();
        withStore(home, tickAgo(2400));
        writeFileSync(join(historyRoot(home), 'op'),
          formatOpMarker({ verb: 'prune', pid: process.pid, startMs: Date.now() - 2_400_000, procStart: String(Number(me.procStart) + 1), bootId: me.bootId }), { mode: 0o600 });
      },
      absent: ['WARN history: op-running'] },
```

Check first that both anchors are unique, from the repository root. Each of these prints 1:
- `grep -c 'prune ${dead} ${Date.now() - 2_400_000}' server/test/ccrc-doctor.test.ts`
- `grep -c "const metaOnFreshTick = " server/test/ccrc-doctor.test.ts`

- [ ] **Step 6: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748|removes a malformed marker|a FIFO at the op marker')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'D-5748')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5748')
```

The filters select 5, 2 and 2 tests. Expected red, with Step 3's lib in place and the writer and both readers not yet changed (measured at `bd363a76b`):
- `history-op`: `3 failed | 2 passed`. The FIFO and malformed cases pass. The failures:
  - the killed pass's marker: `"import <pid> <ms>\n": expected null not to be null` (the writer still writes three fields);
  - the identity case: `a live pid with another start time (a reused pid): the marker is stale, and the pass removes it: expected true to be false`;
  - the EPERM case: `EPERM is not ours: the fleet is one UNIX user: expected true to be false`.
- `history-cli`: `2 failed`, both at `toEqual` on `op`: `expected { verb: 'prune', pid: <pid>, …(2) } to deeply equal { verb: 'prune', pid: <pid>, …(2) }` (`alive` is true for the reused pid), and the same for pid 1 (EPERM read as alive).
- `ccrc-doctor`: `1 failed | 1 passed`. The reused-pid row fails with `no "FAIL history: tick-stale: store " line`. The identity-equal row passes on the base's kill probe; its guard is M9's doctor run in Step 13.

- [ ] **Step 7: Write the writer and both readers.**

(a) In `ccd/history/sweep.mjs`, in the lib import, replace `decideOpGate, formOf, parseOpMarker, formatPassMarker,` with

```js
decideOpGate, formOf, parseOpMarker, formatOpMarker, decideOpLive, formatPassMarker,
```

Then replace the whole block from `/** Whether a pid names a live process (EPERM: alive, another user's). */` through the end of `writeOpMarker`:

```js
/** Whether a pid names a live process (EPERM: alive, another user's). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'EPERM';
  }
}

/** ~/.ccrc/history/op (§9.6 op-running), parsed by lib's one grammar; null when absent or malformed. */
export function readOpMarker(P) {
  const text = readTrimmed(P.op);
  return text === null ? null : parseOpMarker(text);
}

/** A marker whose pid is dead, or which names none, is stale: the next pass removes it (§9.6). */
export function removeStaleOpMarker(P) {
  const r = readBounded(P.op, CONTROL_FILE_MAX, false);
  if (r.state === 'absent') return;
  // An unreadable marker (a FIFO, a link, a directory, over the cap) names no live pid, so it is stale (D-4347 (history-planted-entries-never-wedge)).
  const m = r.state === 'value' ? parseOpMarker(r.value.trim()) : null;
  if (m === null || !pidAlive(m.pid)) removeEntry(P.op);
}

/** Written under the lock when an --op pass starts; removed when it ends (§9.6). */
export function writeOpMarker(P, verb, nowMs) {
  writeFileAtomic(P.op, `${verb} ${process.pid} ${nowMs}\n`, 0o600);
}
```

with

```js
/** D-5748 (history-op-marker-identity): what lib's decideOpLive reads about an op marker's pid, measured now. Its identity is
 *  procIdentityOf's (D-5016: both fields, or both null when either cannot be measured), and `kill` is the answer of
 *  `kill(pid, 0)` as a word: 'ok', 'eperm' (another user's process), or 'esrch' for no such process and for any other refusal
 *  (a pid the kernel will not take). This replaces the two `pidAlive` copies, which read EPERM as alive. */
export function measureOpProcess(pid) {
  const identity = procIdentityOf(pid);
  let kill = 'ok';
  try {
    process.kill(pid, 0);
  } catch (e) {
    kill = e !== null && typeof e === 'object' && e.code === 'EPERM' ? 'eperm' : 'esrch';
  }
  return { procStart: identity === null ? null : identity.procStart, bootId: identity === null ? null : identity.bootId, kill };
}

/** A marker that names no operator pass running now is stale: the next pass removes it (§9.6). Since D-5748 "running now" is
 *  lib's decideOpLive, the rule status reads too: a marker that names its process is live only when the identity measured now
 *  equals it, so a reused pid or another boot is stale; a legacy three-field marker is live only when kill(pid, 0) answers ok. */
export function removeStaleOpMarker(P) {
  const r = readBounded(P.op, CONTROL_FILE_MAX, false);
  if (r.state === 'absent') return;
  // An unreadable marker (a FIFO, a link, a directory, over the cap) names no live pid, so it is stale (D-4347 (history-planted-entries-never-wedge)).
  const m = r.state === 'value' ? parseOpMarker(r.value.trim()) : null;
  if (m === null || !decideOpLive(m, measureOpProcess(m.pid))) removeEntry(P.op);
}

/** Written under the lock when an --op pass starts; removed when it ends (§9.6). Since D-5748 it names its process: the pid's
 *  identity (procIdentityOf, D-5016) follows the start, and a box that cannot measure it (no /proc) writes the legacy three
 *  fields. A failed write still throws, as H-101 needs. */
export function writeOpMarker(P, verb, nowMs) {
  const identity = procIdentityOf(process.pid);
  writeFileAtomic(P.op, formatOpMarker({
    verb, pid: process.pid, startMs: nowMs,
    procStart: identity === null ? null : identity.procStart, bootId: identity === null ? null : identity.bootId,
  }), 0o600);
}
```

`procIdentityOf` is a function declaration earlier in the file. `readTrimmed` keeps its other callers. Check: `grep -c 'function pidAlive\|readOpMarker' ccd/history/sweep.mjs` prints 0 (the new doc comment names `pidAlive` once, as history).

(b) In `ccd/history/cli.mjs`:
- In the first lib import, replace `decideGrepIndex, parsePassMarker, decidePassLive, parsePassDied,` with `decideGrepIndex, parsePassMarker, decidePassLive, parsePassDied, decideOpLive,`.
- Delete the whole function, with the blank line after it:

```js
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'EPERM';
  }
}
```

- Replace `import { loadSecrets, procIdentityOf } from './sweep.mjs';` with `import { loadSecrets, procIdentityOf, measureOpProcess } from './sweep.mjs';`.
- In `boxFacts`, replace the line `  env.op = m === null ? null : { verb: m.verb, pid: m.pid, alive: pidAlive(m.pid), start_ms: m.startMs };` with

```js
  // D-5748 (history-op-marker-identity): `alive` is lib's decideOpLive over what is measured of the pid now, the rule the stale-marker
  // removal reads too: a marker that names its process is alive only when its identity measures equal (a reused pid is not), and
  // a legacy three-field one only when kill(pid, 0) answers ok (EPERM is another user's process: the fleet is one UNIX user).
  env.op = m === null ? null : { verb: m.verb, pid: m.pid, alive: decideOpLive(m, measureOpProcess(m.pid)), start_ms: m.startMs };
```

Check: `grep -c 'pidAlive' ccd/history/cli.mjs` prints 0. `sweep.mjs`'s entry guard keys on `process.argv[1]`, so importing one more name from it runs nothing; `cli.mjs` already imports `procIdentityOf` that way.

- [ ] **Step 8: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748|removes a malformed marker|a FIFO at the op marker')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'D-5748|the durability state')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5748|op-running|op marker')
```

Expected green (measured): `5 passed`; `3 passed`, the two new cases and the envelope case, whose legacy dead-pid marker reads `alive: false` and `start_ms` from `m.startMs`; and `5 passed` for the doctor: the two new rows, the two legacy rows (`op-running` and the dead pid), which stay green unchanged, and the relay row `op-running (warn)`.

- [ ] **Step 9: Write the failing tier test.** In `server/test/lifecycle.test.ts`, directly after `import { LIFECYCLE } from '../../shared/lifecycle.js';`, insert

```ts
import { parseOpMarker, parsePassMarker } from '../../ccd/history/lib.mjs';
```

and directly after the `declares history-store-id` case's last lines

```ts
    expect(c!.ruling).toContain('the first pass that commits a tick removes pass-died');
  });
```

insert

```ts

  // W5h-2 Task 4 (D-5748, and review 467 F4's erratum): the tier's two marker bounds are the longest lines the op and pass grammars
  // take, measured here from lib's parsers rather than restated, so a grammar that widens or a tier that drifts goes red.
  it('the history-store-id tier states the longest op and pass marker lines the grammars accept: 119 B and 86 B (D-5748)', () => {
    const tier = LIFECYCLE.find((x) => x.name === 'history-store-id')!.tier;
    const BOOT = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
    const passFields = ['9'.repeat(10), '9'.repeat(16), '9'.repeat(20)];
    const opFields = ['a'.repeat(32), ...passFields];
    const line = (f: string[]): string => `${f.join(' ')} ${BOOT}\n`;
    expect(parsePassMarker(line(passFields)), 'the longest pass marker parses').not.toBeNull();
    expect(parseOpMarker(line(opFields)), 'the longest op marker parses').not.toBeNull();
    for (let i = 0; i < passFields.length; i += 1) {
      expect(parsePassMarker(line(passFields.map((v, j) => (j === i ? `9${v}` : v)))), `pass field ${i} one longer`).toBeNull();
    }
    for (let i = 0; i < opFields.length; i += 1) {
      expect(parseOpMarker(line(opFields.map((v, j) => (j === i ? `${v[0]}${v}` : v)))), `op field ${i} one longer`).toBeNull();
    }
    expect(tier).toContain(`pass (a marker line of about 70 B, at most ${Buffer.byteLength(line(passFields))} B)`);
    expect(tier).toContain(`op (a marker line of about 77 B, at most ${Buffer.byteLength(line(opFields))} B)`);
    expect(tier).not.toContain('at most 87 B');
  });
```

The "about" figures are the common case on a box: a 6- or 7-letter verb, a 7-digit pid, a 13-digit clock and a 9- or 10-digit start time. The op figure, about 77 B, is computed from those widths, a prediction, never measured on a live marker; only the "at most" bounds are measured, by this case. Task 6's Step 8 checks these exact tokens and writes none of its own. `lifecycle.test.ts` runs on macOS too; the case is pure.

- [ ] **Step 10: Run it and see it fail.**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'D-5748|declares history-store-id')
```

Expected red (measured): `1 failed | 1 passed`, `expected '<64 B each, but pass (a marker line o…' to contain 'pass (a marker line of about 70 B, at…'`. The grammar halves already pass; the tier text is what fails.

- [ ] **Step 11: Write the tier, the spec rows and the B2 plan's two sentences.** One edit carries both the op bound (D-5748) and the pass erratum (86 B, no number). Each `old` below is asserted unique before it is replaced (Step 13's `mut` helper does exactly that, and can be used here).

(a) `shared/lifecycle.ts`, in the `history-store-id` row. Replace

```ts
tier: '<64 B each, but pass (a marker line of about 70 B, at most 87 B) and pass-died (one JSON line of about 76 B, at most 100 B): <128 B each',
```

with

```ts
tier: '<64 B each, but op (a marker line of about 77 B, at most 119 B), pass (a marker line of about 70 B, at most 86 B) and pass-died (one JSON line of about 76 B, at most 100 B): <128 B each',
```

and in the same row's `ruling`, replace `and the next pass removes a dead pid\'s op;` with

```ts
and the next pass removes an op that names no live pass, a dead or reused pid\'s (D-5748);
```

(b) The spec, §9.4's `history-store-id` row. In its tier cell, replace

```markdown
<64 B each, but `pass` (about 70 B, at most 87 B) and `pass-died` (about 76 B, at most 100 B): <128 B each
```

with

```markdown
<64 B each, but `op` (about 77 B, at most 119 B; W5h-2, D-5748), `pass` (about 70 B, at most 86 B) and `pass-died` (about 76 B, at most 100 B): <128 B each
```

and in its ruling cell, replace ``a dead pid's `op` is removed by the next pass, §9.6;`` with

```markdown
an `op` that names no live pass, a dead or reused pid's, is removed by the next pass, §9.6 and D-5748;
```

(c) The spec, §9.6's `op-running` bullet. Replace its first two sentences

```markdown
   - `op-running`: `~/.ccrc/history/op` names a live pid. An `--op` pass writes `<verb> <pid> <start_ms>` there under the lock when it starts and removes it when it exits; a dead pid's marker is stale, and the next pass removes it.
```

with

```markdown
   - `op-running`: `~/.ccrc/history/op` names a live operator pass. An `--op` pass writes `<verb> <pid> <start_ms> <proc_start> <boot_id>` there under the lock when it starts and removes it when it exits. Since W5h-2 (D-5748) the marker carries the pass marker's identity (D-5016): it is live only when the pid's start time and the boot id, measured now, equal the marker's, and a mismatch is never retried by `kill(pid, 0)`, so a dead or reused pid's marker is stale, and the next pass removes it. A legacy `<verb> <pid> <start_ms>` marker, left by an `--op` pass of an older build still running across `ccrc update`, is live only while `kill(pid, 0)` succeeds; EPERM is not live, because the fleet runs as one UNIX user.
```

The bullet's next sentence (`A doctor --backup holds the lock …`) stays. §17's rev-3.6 line that records the 87 B erratum as carried (`:3551`) is history and stays as written.

(d) `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md`. D-5016's entry ends `about 70 B, at most 87 B, so the row's tier no longer reads "<64 B each" for it).`. Append after it, on the same line:

```markdown
 Erratum (wave 5h-2, review 467 F4): the longest marker the grammar takes is 86 B, not 87 B; the manifest's tier and spec §9.4's row say 86 since wave 5h-2 Task 4.
```

D-5026's entry ends ``so a reused pid reads not live, and `removeStaleOpMarker` removes it.``. Append after it, on the same line:

```markdown
 Closed by wave 5h-2's D-5748 (residual (i) only): the op marker names its process, and status and `removeStaleOpMarker` read it through one rule, `decideOpLive`. Residual (h) stands and now reaches the op marker too.
```

Both definitions stay as written; only a sentence is appended to each.

- [ ] **Step 12: Run it and see it pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'D-5748|declares history-store-id')
```

Expected green (measured): `2 passed`. The `declares history-store-id` case's `ruling` assertions do not read the clause that changed.

- [ ] **Step 13: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h2/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"
cp shared/lifecycle.ts "$SCRATCH/lifecycle.orig"

# M1: the five-field alternative made unmatchable, so the identity never parses.
mut ccd/history/lib.mjs '([0-9]{1,16})(?: ([0-9]{1,20}) ' '([0-9]{1,16})(?:NEVER ([0-9]{1,20}) '
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'formatOpMarker writes')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 1 failed | 1 passed, expected null to deeply equal { verb: 'import', pid: 4242, …(3) }.

# M2: only the boot id compared, so a reused pid reads live.
mut ccd/history/lib.mjs '  return decidePassLive(marker, identityNow);' '  return identityNow !== null && identityNow.bootId === marker.bootId;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideOpLive: a reused pid')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected true to be false.

# M3: EPERM read as live for a legacy marker.
mut ccd/history/lib.mjs "return measured.kill === 'ok';" "return measured.kill !== 'esrch';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideOpLive: legacy, kill answers EPERM')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected true to be false.

# M4: an identity-bearing marker that mismatches falls back to the kill probe (R5 says it never does).
mut ccd/history/lib.mjs '  return decidePassLive(marker, identityNow);' "  return decidePassLive(marker, identityNow) || measured.kill === 'ok';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideOpLive')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 3 failed | 7 passed, the reused-pid, another-boot and unmeasurable rows, expected true to be false.

# M5: half an identity written silently.
mut ccd/history/lib.mjs "  if ((start === null) !== (boot === null)) throw new TypeError('formatOpMarker: procStart and bootId are both measured or both null');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'refuses half of one')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected [Function] to throw an error.

# M6: each identity field optional on its own, so a four-field marker parses.
mut ccd/history/lib.mjs '(?: ([0-9]{1,20}) ([0-9a-f]{8}' '(?: ([0-9]{1,20}))?(?: ([0-9a-f]{8}'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'answers null for every other shape: four fields')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): "import 4242 1700000000000 987654": expected { verb: 'import', pid: 4242, …(3) } to be null.

# M7: the writer keeps writing three fields.
mut ccd/history/sweep.mjs 'procStart: identity === null ? null : identity.procStart, bootId: identity === null ? null : identity.bootId,
  }), 0o600);' 'procStart: null, bootId: null,
  }), 0o600);'
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured): 1 failed | 2 passed, "import <pid> <ms>\n": expected null not to be null.

# M8: the stale-marker removal keeps the old kill probe (EPERM alive), as pidAlive did.
mut ccd/history/sweep.mjs '  if (m === null || !decideOpLive(m, measureOpProcess(m.pid))) removeEntry(P.op);' "  if (m === null || measureOpProcess(m.pid).kill === 'esrch') removeEntry(P.op);"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured): 2 failed | 1 passed, the reused-pid case (expected true to be false) and the EPERM case.

# M9: status keeps the old kill probe for op.alive.
mut ccd/history/cli.mjs 'alive: decideOpLive(m, measureOpProcess(m.pid)),' "alive: measureOpProcess(m.pid).kill !== 'esrch',"
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'D-5748')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5748')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): history-cli 2 failed, op.alive true where false is expected; ccrc-doctor 1 failed | 1 passed,
# no "FAIL history: tick-stale: store " line on the reused-pid row.

# M10: the measurement reads EPERM as ok.
mut ccd/history/sweep.mjs "    kill = e !== null && typeof e === 'object' && e.code === 'EPERM' ? 'eperm' : 'esrch';" "    kill = e !== null && typeof e === 'object' && e.code === 'EPERM' ? 'ok' : 'esrch';"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'D-5748')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured): history-op 1 failed | 2 passed (the EPERM case); history-cli 1 failed | 1 passed (the legacy case, pid 1).

# M11: the pass tier back at 87 B (the erratum undone).
mut shared/lifecycle.ts 'at most 86 B)' 'at most 87 B)'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'D-5748')
cp "$SCRATCH/lifecycle.orig" shared/lifecycle.ts
# Expected RED (measured): expected '<64 B each, but op (a marker line of …' to contain 'pass (a marker line of about 70 B, at…'.

# M12: the pass grammar's pid widened to 11 digits, so the tier's 86 B no longer bounds it.
mut ccd/history/lib.mjs "const m = /^([1-9][0-9]{0,9}) ([0-9]{1,16}) ([0-9]{1,20})" "const m = /^([1-9][0-9]{0,10}) ([0-9]{1,16}) ([0-9]{1,20})"
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'D-5748')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): pass field 0 one longer: expected { pid: 99999999999, …(3) } to be null.

# M13: the op grammar's verb widened to 33, so the tier's 119 B no longer bounds it.
mut ccd/history/lib.mjs "const m = /^([a-z-]{1,32}) ([1-9][0-9]{0,9}) ([0-9]{1,16})(?: " "const m = /^([a-z-]{1,33}) ([1-9][0-9]{0,9}) ([0-9]{1,16})(?: "
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'D-5748')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the longest marker the grammar takes')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): op field 0 one longer: expected { …(5) } to be null, in both files.

# M14: the stale-marker removal made unconditional. Under the lock, a bind arm (adopt, restore, rebuild) reads its OWN live
# marker: finishBind opens the store, and openStore calls removeStaleOpMarker, so this mutant drops op-running mid-pass.
mut ccd/history/sweep.mjs '  if (m === null || !decideOpLive(m, measureOpProcess(m.pid))) removeEntry(P.op);' '  removeEntry(P.op);'
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5748|keeps one naming a live pid')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted from the code at the plan's review, not yet measured: record the measured line in the commit):
# 2 failed | 2 passed. The identity case fails at its CONTROL "the identity measured equal is a live pass, and its marker
# stands" (the planted marker is gone, ENOENT), and the legacy case at "a live pid's marker is another pass's, and stands".
# No case observes a bind arm's own marker after its finishBind; these two pin the same conditional, and the reviewer
# probes the bind arms.

cmp "$SCRATCH/lib.orig" ccd/history/lib.mjs && cmp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs \
  && cmp "$SCRATCH/cli.orig" ccd/history/cli.mjs && cmp "$SCRATCH/lifecycle.orig" shared/lifecycle.ts && echo restored
```

Expected: `restored`. Then run Steps 4, 8 and 12's commands once more: green.

- [ ] **Step 14: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green. These were measured at `bd363a76b` with this task alone; on this plan's tree each file's count is the earlier tasks' count plus this task's.
- `history-lib`: `1097 passed`, the base's 1083 plus 14.
- `history-op`: `110 passed`, the base's 108 plus 2.
- `history-cli`: `74 passed | 1 skipped`, the base's 72 plus 2.
- `lifecycle`: `80 passed`, the base's 79 plus 1.
- `history-recover` and `history-holds` together: `181`, all green. A combined run on a loaded box once failed `O43, a reused inode` at 66 s. It passed alone, and it does not read the op marker. The two killed-pass cases there (`the killed pass left its op marker`) leave a five-field marker now, and the next tick removes it, because the killed pid's identity no longer measures.
- `single-definition -t 'ccrc history'`: `92 passed`.
- `ccrc-doctor -t history`: `125 passed`, including both new rows and the two legacy rows.
- tsc: no line names a file this task touched. A line that names only `agent/src/` (the `ws` module) or `test/workflow-yaml-parses.test.ts` (the `yaml` module) comes from the worktree's install, not this task.

- [ ] **Step 15: Check the departure's entry.** D-5748's entry is already in this plan's "Deviations found" (it came with the plan): `grep -c '^- \*\*D-5748\*\* — ' docs/superpowers/plans/2026-10-19-ccrc-history-w5h2-redaction-and-ops.md` prints 1. Never add a second. If a figure this task measured differs from the entry's, correct the entry and add the plan file to Step 16's `git add`. Then run the ledger check:

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. The deviation-refs test compares this branch's entries against `origin/main` without merging.

- [ ] **Step 16: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs shared/lifecycle.ts \
  docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md \
  server/test/history-lib.test.ts server/test/history-op.test.ts server/test/history-cli.test.ts \
  server/test/ccrc-doctor.test.ts server/test/lifecycle.test.ts
git commit -m "fix(history): the op marker names its process, so a reused pid no longer reads as a live operator pass (W5h-2 Task 4, D-5748)"
```

D-5748's entry is the one in "Deviations found" at the end of this plan; it is not repeated here, so each number stays defined exactly once in this file.

### Task 5: lag-high's remedy names the hold that keeps the lag high

D-5027 made a held node's own FAIL answer for `tick-stale`. It left `lag-high` judged as before: 30 minutes after the last tick that found nothing behind, a held node also FAILs `lag-high`, because no scheduled pass ingests while the hold stands, so the lag is real. That FAIL's remedy is still the one fixed text, `HEALTH_REMEDIES['lag-high']`: "read the sweep …; a backlog drains within each run's budget, a stuck file shows the same lag every tick". On a held node that text points the operator at the timer and the sweep's log, when the only thing that drains the lag is clearing the hold. D-5027 names this as its follow-up, and scope b2-ops item B2-4 measured it: on a node held at `migration-needs-op`, `migration-refused` or `schema-newer`, and beside `at-cap` or `capture-paused-low-disk`, lag-high carries the same generic remedy every time.

This task implements coordinator ruling R6. `remedyFor('lag-high', h)` answers with the standing hold's own remedy for D-5027's three holds only:
- `snapshot-needs-op` → `migration-needs-op`'s remedy (`ccrc history doctor --migrate`);
- `refuse-low-disk` → `migration-refused`'s remedy (free space on the filesystem holding the store);
- a newer store → `schema-newer`'s remedy (`ccrc update`).

`schema-newer` comes first when it stands beside a migration verdict. With no hold, the remedy is `HEALTH_REMEDIES['lag-high']`, unchanged. A capture pause (`at-cap`, `capture-paused-low-disk`) is not a hold here: each has its own FAIL with its own remedy, so R6 does not add it. The hold's remedy is reached through `remedyFor(hold, h)`, so it stays single-sourced, including `migration-refused`'s computed byte count. The FAIL set and the precedence do not change, only one remedy's text. No D-number: D-5027 already names this follow-up (R6).

**Order (R8).** Wave 5h-1 lands first and edits the same regions of `lib.mjs`:
- its Task 2 adds two entries to `HEALTH_REMEDIES` after `'export-segment-missing'` and two cases to `remedyFor` directly above `    default:`;
- its Task 7 edits `remedyFor`'s `case 'store-unbound':` in place;
- it inserts lines in `deriveHealth` after the `export-overdue` FAIL line and the `export-segment-missing` WARN line.

This task's two hunks are elsewhere: one at the head of `remedyFor` (the two helpers above it, and the first case directly after its `switch (word) {`), and the one-line `schema-newer` `if` in `deriveHealth`. Anchor both by the quoted content, never by 5h-1's line numbers, keep each a separate hunk, and use no 5h-1 name.

**Files:**
- Modify: `ccd/history/lib.mjs`. Line numbers were measured at `bd363a76b`; re-anchor by the quoted content:
  - two module-private functions inserted directly above `function remedyFor(word, h) {` (`:3437`), after `evidenceOf`'s closing brace (`:3435`);
  - one `case 'lag-high':` block directly after `remedyFor`'s `  switch (word) {` (`:3438`). The anchor is the two-line pair `function remedyFor(word, h) {` / `  switch (word) {`, because `  switch (word) {` alone appears twice in the file (`:3057` too);
  - in `deriveHealth`, the line `  if (h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion)) {` (`:3642`), replaced in place.
- Test: `server/test/history-lib.test.ts`:
  - one nested describe in task 28's `describe('D-5027 a held pass that ended recently is fresh for the tick-stale FAIL only', …)` (`:4215`), directly after the closing `    });` of its case `it('it is no tick: catching-up, lag-unmeasured and lag-high do not read it', …)` (`:4234-4241`). That case's last assertion reads `'lag-high is judged as it always was'` (`:4240`). The describe reuses that block's `HELD`, and task 28's `base`, `words`, `NOW` and `MIN` (`:3661-3680`).
  - two lines in the `dynamic` list of `it('no remedy says a ccrc history verb that ships in this build arrives with a wave (FR3-d, whole-branch fix 1 item C)', …)` (`:3834`), directly after `      { sizeBytes: 41 * 2 ** 30 }, { capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 },` (`:3840`). The scan then reads the three new derived texts too. Today its inputs never put lag-high on a held node.
- Test: `server/test/history-op.test.ts`. In `describe('D-5027: a held pass is fresh for tick-stale', …)` (`:577`):
  - the `verdict` helper's two type annotations gain `remedy: string` (`:612`, `:615`);
  - the case `it('F2 (review 466): past 30 min from the last zero-behind tick a held node also FAILs lag-high …', …)` (`:633-638`) gains three lines after its `toContain('over 1800 s');` assertion (`:637`).
- Not edited:
  - `HEALTH_REMEDIES` (`'lag-high'` at `:3386` stays the default text, R6);
  - `ccd/history/lib.d.mts` (no export is added, and `HealthInputs` is unchanged);
  - `ccd/history/cli.mjs` and `ccd/ccrc-doctor-checks` (doctor relays the remedy as status hands it over);
  - `server/test/ccrc-doctor.test.ts` (its `lag-high` rows assert no remedy text: measured green, below);
  - the spec, by this task. §9.6's `lag-high` bullet names the FAIL and that a held node FAILs it, and spells no remedy text. Measured: `grep -c 'a backlog drains' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` prints 0. Task 6's Step 8 adds the one sentence that says what this remedy now names, citing D-5027 bare.

**Interfaces:**
- Consumes (base, `lib.mjs`): `remedyFor(word, h)`, `HEALTH_REMEDIES`, `deriveHealth(h)`, and its `item(word, detail)`, which calls `remedyFor(word, h)` for every item. It also reads the `HealthInputs` fields `migration`, `userVersion` and `codeVersion`, and, through `remedyFor('migration-refused', h)`, `dbPath`, `thresholdBytes` and `sizeBytes`.
- Consumes (tests): task 28's `base`, `words`, `NOW`, `MIN` and D-5027's `HELD` in `history-lib.test.ts`; D-5027's `heldBox` and `verdict` in `history-op.test.ts`. All are fixture HOMEs through `historyHelpers.ts`.
- Produces (`lib.mjs`, module-private, no export):
  - `schemaNewerOf(h): boolean`: `h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion)`. It is the one spelling of the predicate, read by `deriveHealth`'s `schema-newer` FAIL and by `lagHoldOf`.
  - `lagHoldOf(h): 'schema-newer' | 'migration-needs-op' | 'migration-refused' | null`: the hold's own FAIL word, `schema-newer` first.
  - `remedyFor('lag-high', h)`:
    - with no hold, `HEALTH_REMEDIES['lag-high']`;
    - with a hold, `` `no scheduled pass ingests while ${hold} stands, so this lag cannot drain until it clears: ${remedyFor(hold, h)}` ``.

**Choices this task makes:**
- **The hold's whole remedy, through `remedyFor`.** A fixed per-hold text would be a second copy, and it would lose `migration-refused`'s computed byte count. Mutant M6 pins this.
- **One predicate for a newer store.** `deriveHealth`'s `schema-newer` test is compound, and a second copy in `lagHoldOf` could drift from it, so it is extracted. The two migration verdicts are one equality each, spelled as `deriveHealth` spells them.
- **The sentence says why, then what to do.** "no scheduled pass ingests while … stands" is true of all three holds. `planRun` holds on `refuse-low-disk` and `snapshot-needs-op`, and `openStore` refuses a newer store before the held arm. Doctor prints the hold's remedy twice on such a node, once on each line. That is accepted: the lag-high line would otherwise send the operator to the timer.
- **Independent of Task 4.** Task 4 changes the op marker's liveness, which feeds `opLive`, then `stateHeld`, and so whether lag-high is pushed at all. This task changes only the remedy of a lag-high that is pushed.
- **R7 holds.** D-5027's stale-stamp window stays text only, and `heldFresh` is not touched.

- [ ] **Step 1: Confirm the anchors.** From the repository root, on `main` after wave 5h-1 has merged:

```bash
grep -cxF 'function remedyFor(word, h) {' ccd/history/lib.mjs
grep -cxF "  if (h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion)) {" ccd/history/lib.mjs
grep -cF "case 'lag-high'" ccd/history/lib.mjs
grep -cE 'schemaNewerOf|lagHoldOf' ccd/history/lib.mjs
grep -cF "'lag-high is judged as it always was'" server/test/history-lib.test.ts
grep -cxF "      { sizeBytes: 41 * 2 ** 30 }, { capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 }," server/test/history-lib.test.ts
grep -cxF "  const verdict = (box: HistoryBox): Array<{ word: string; detail: string }> => {" server/test/history-op.test.ts
grep -cxF "    return (r.json!['health'] as { fail: Array<{ word: string; detail: string }> }).fail;" server/test/history-op.test.ts
grep -cxF "    expect(fail.find((i) => i.word === 'lag-high')!.detail).toContain('over 1800 s');" server/test/history-op.test.ts
```

Expected: `1 1 0 0 1 1 1 1 1`, one per line (measured at `bd363a76b`; 5h-1 touches none of these lines). Any other count means the region moved under a later merge. Re-anchor by content; never by line number.

- [ ] **Step 2: Write the failing pure tests.** In `server/test/history-lib.test.ts`, inside `describe('D-5027 a held pass that ended recently is fresh for the tick-stale FAIL only', …)`, replace the two lines

```ts
      expect(words(high, 'fail'), 'lag-high is judged as it always was').toEqual(['lag-high', 'migration-needs-op']);
    });
```

with

```ts
      expect(words(high, 'fail'), 'lag-high is judged as it always was').toEqual(['lag-high', 'migration-needs-op']);
    });
    // W5h-2 Task 5 (D-5027's follow-up, coordinator ruling R6): while a hold stands no scheduled pass ingests, so the lag cannot drain,
    // and lag-high's remedy is the hold's own (schema-newer first). A capture pause is not a hold here: it has its own FAIL.
    describe('lag-high on a held node names the hold that keeps the lag high (D-5027, R6)', () => {
      const GiB = 2 ** 30;
      const failOf = (r: healthLib.HealthResult, word: string): healthLib.HealthItem => {
        const i = r.fail.find((x) => x.word === word);
        expect(i, `${word} in ${JSON.stringify(words(r, 'fail'))}`).toBeDefined();
        return i!;
      };
      const HOLDS: Array<[string, string, Partial<healthLib.HealthInputs>, string]> = [
        ['snapshot-needs-op', 'migration-needs-op', {}, 'the operator runs ccrc history doctor --migrate'],
        ['refuse-low-disk', 'migration-refused', { migration: 'refuse-low-disk' }, 'free space on the filesystem holding /home/u/.ccrc/history/db until more than 21600000000 bytes are free'],
        ['refuse-newer', 'schema-newer', { migration: 'refuse-newer', userVersion: 3, codeVersion: 2 }, '(ccrc update)'],
        ['a stored version past this build\'s', 'schema-newer', { migration: 'none', userVersion: 3, codeVersion: 2 }, '(ccrc update)'],
      ];
      it.each(HOLDS)('held by %s: lag-high\'s remedy is the %s FAIL\'s own remedy, behind the sentence that says why the lag stands', (_v, hold, o, fragment) => {
        const r = healthLib.deriveHealth(base({ ...HELD, lagS: 7200, heldPassMs: NOW - MIN, ...o }));
        const own = failOf(r, hold).remedy;
        expect(own, 'CONTROL: the fragment is the hold\'s own remedy').toContain(fragment);
        expect(failOf(r, 'lag-high').remedy).toBe(`no scheduled pass ingests while ${hold} stands, so this lag cannot drain until it clears: ${own}`);
      });
      it('schema-newer beside a migration verdict: the remedy names schema-newer, never the migration', () => {
        const r = healthLib.deriveHealth(base({ ...HELD, lagS: 7200, heldPassMs: NOW - MIN, userVersion: 3, codeVersion: 2 }));
        expect(words(r, 'fail'), 'CONTROL: both FAILs stand').toEqual(expect.arrayContaining(['schema-newer', 'migration-needs-op']));
        const remedy = failOf(r, 'lag-high').remedy;
        expect(remedy).toContain('while schema-newer stands');
        expect(remedy).toContain('(ccrc update)');
        expect(remedy).not.toContain('doctor --migrate');
      });
      it('CONTROL: with no hold, lag-high\'s remedy is HEALTH_REMEDIES[\'lag-high\'], unchanged', () => {
        expect(failOf(healthLib.deriveHealth(base({ lagS: 7200 })), 'lag-high').remedy).toBe(healthLib.HEALTH_REMEDIES['lag-high']);
      });
      it.each([
        ['at-cap', { capturePause: 'at-cap', sizeBytes: 50 * GiB }],
        ['capture-paused-low-disk', { capturePause: 'low-disk' }],
      ] as Array<[string, Partial<healthLib.HealthInputs>]>)('a capture pause is not a hold here (R6): beside %s, lag-high keeps the default remedy', (pause, o) => {
        const r = healthLib.deriveHealth(base({ lagS: 7200, ...o }));
        expect(words(r, 'fail'), 'CONTROL: the pause FAILs on its own').toEqual(['lag-high', pause]);
        expect(failOf(r, 'lag-high').remedy).toBe(healthLib.HEALTH_REMEDIES['lag-high']);
      });
    });
```

`HELD` is that describe's `{ migration: 'snapshot-needs-op', userVersion: 1, codeVersion: 2, sizeBytes: 1_600_000_000, lastTickMs: NOW - 54 * MIN, lagS: 5 }`. With `heldPassMs` a minute old, D-5027 holds `tick-stale` back. `migration-refused`'s computed remedy is `thresholdBytes + sizeBytes`, that is `20_000_000_000 + 1_600_000_000`, so the fragment's byte count is exact.

Then, in the FR3-d scan's `dynamic` list, replace the one line

```ts
      { sizeBytes: 41 * 2 ** 30 }, { capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 },
```

with

```ts
      { sizeBytes: 41 * 2 ** 30 }, { capturePause: 'at-cap', sizeBytes: 50 * 2 ** 30 },
      // W5h-2 Task 5 (R6): lag-high's remedy on a node held by each of D-5027's three holds.
      ...(['snapshot-needs-op', 'refuse-low-disk', 'refuse-newer'] as const).map((migration) => ({ migration, userVersion: 1, codeVersion: 2, lagS: 7200 })),
```

Today that scan never puts lag-high on a held node. With these inputs it also reads the three texts this task derives, one of which names `ccrc history doctor --migrate`.

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5027, R6')
```

Expected: red, `5 failed | 3 passed` (measured at `bd363a76b`). The three that pass are the CONTROL and the two capture-pause rows, which already hold. The four `HOLDS` rows fail with `AssertionError: expected 'read the sweep: journalctl --user -u …' to be 'no scheduled pass ingests while migra…' // Object.is equality` (`… while schem…` on the schema-newer rows). The combined row fails with `expected 'read the sweep: journalctl --user -u …' to contain 'while schema-newer stands'`. The FR3-d scan stays green: its new inputs carry today's default text.

- [ ] **Step 4: Write the failing end-to-end test.** In `server/test/history-op.test.ts`, in `describe('D-5027: a held pass is fresh for tick-stale', …)`, replace the line

```ts
  const verdict = (box: HistoryBox): Array<{ word: string; detail: string }> => {
```

with

```ts
  const verdict = (box: HistoryBox): Array<{ word: string; detail: string; remedy: string }> => {
```

and the line

```ts
    return (r.json!['health'] as { fail: Array<{ word: string; detail: string }> }).fail;
```

with

```ts
    return (r.json!['health'] as { fail: Array<{ word: string; detail: string; remedy: string }> }).fail;
```

`status --json` already carries each item's `remedy`, so this widens the type and nothing else. Then, in the case `it('F2 (review 466): past 30 min from the last zero-behind tick a held node also FAILs lag-high …', …)`, replace the one line

```ts
    expect(fail.find((i) => i.word === 'lag-high')!.detail).toContain('over 1800 s');
```

with

```ts
    expect(fail.find((i) => i.word === 'lag-high')!.detail).toContain('over 1800 s');
    // W5h-2 Task 5 (R6): the lag cannot drain while the hold stands, so lag-high's remedy is the hold's own, end to end through status.
    const needsOp = fail.find((i) => i.word === 'migration-needs-op')!.remedy;
    expect(needsOp, 'CONTROL: the hold\'s own remedy names the verb').toContain('ccrc history doctor --migrate');
    expect(fail.find((i) => i.word === 'lag-high')!.remedy).toBe(`no scheduled pass ingests while migration-needs-op stands, so this lag cannot drain until it clears: ${needsOp}`);
```

The node is real: two held passes over the V2 seam's line in a fixture HOME, with the tick rows and the lag mark aged 35 min. `status --json` reads it as `deriveHealth` reads it.

- [ ] **Step 5: Run it and see it fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'F2 \(review 466\)')
```

Expected: red, `1 failed` (measured at `bd363a76b`, about 0.7 s): `AssertionError: expected 'read the sweep: journalctl --user -u …' to be 'no scheduled pass ingests while migra…' // Object.is equality`. Its CONTROL line passes before it.

- [ ] **Step 6: Write the remedy.** In `ccd/history/lib.mjs`:

(a) Replace the two lines

```js
function remedyFor(word, h) {
  switch (word) {
```

with

```js
/** Whether the store is newer than this build: deriveHealth's schema-newer FAIL and lagHoldOf read this one predicate. */
function schemaNewerOf(h) {
  return h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion);
}

/** D-5027's follow-up (wave 5h-2 Task 5, coordinator ruling R6): the hold that keeps a lag from draining, as the word of the hold's
 *  own FAIL, or null. No scheduled pass ingests while one stands (planRun holds on a migration verdict; openStore refuses a newer
 *  store before that), so the lag is real and only clearing the hold drains it. D-5027's three holds only, schema-newer first when
 *  it stands beside a migration verdict. A capture pause (at-cap, capture-paused-low-disk) is not one here: it has its own FAIL. */
function lagHoldOf(h) {
  if (schemaNewerOf(h)) return 'schema-newer';
  if (h.migration === 'snapshot-needs-op') return 'migration-needs-op';
  if (h.migration === 'refuse-low-disk') return 'migration-refused';
  return null;
}

function remedyFor(word, h) {
  switch (word) {
    case 'lag-high': {   // R6: on a held node, the hold's own remedy, through remedyFor so it stays single-sourced
      const hold = lagHoldOf(h);
      return hold === null
        ? HEALTH_REMEDIES['lag-high']
        : `no scheduled pass ingests while ${hold} stands, so this lag cannot drain until it clears: ${remedyFor(hold, h)}`;
    }
```

Both helpers are function declarations, so `deriveHealth` can call them wherever it sits in the file.

(b) In `deriveHealth`, replace the one line

```js
  if (h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion)) {
```

with

```js
  if (schemaNewerOf(h)) {   // W5h-2 Task 5: one predicate, which lag-high's remedy reads too
```

Leave `HEALTH_REMEDIES['lag-high']` as it is: it is the no-hold text (R6). Check: `grep -cE 'schemaNewerOf|lagHoldOf' ccd/history/lib.mjs` prints 6.

- [ ] **Step 7: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5027, R6')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'F2 \(review 466\)')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected (each measured at `bd363a76b` with this task alone):
- `8 passed`;
- `1 passed`;
- `history-lib.test.ts` green as a whole. This task adds 8 cases to whatever the earlier tasks left: `1083` → `1091` at `bd363a76b`. That includes task 28's coverage, the `non-empty remedy` case, the `HEALTH_REMEDIES names exactly the warn and fail words` case (no word was added) and the FR3-d scan over the three new inputs.
- tsc prints nothing for this task's files. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install. A line naming `history-lib.test.ts`, `history-op.test.ts` or `ccd/history/` is this task's.

- [ ] **Step 8: Measure every guard red, then green.** From the repository root. The runner is a gitignored scratch tool, never committed. It does the following for each mutant:
1. copies the file to `scratch/keep/`;
2. applies one mutant and runs that mutant's case, which must fail;
3. restores the file and removes the copy;
4. runs the case again, which must pass.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h2/scratch"; mkdir -p "$SCRATCH/keep"
cat > "$SCRATCH/t5-mutants.py" <<'EOF'
import os, shutil, subprocess, sys
KEEP = sys.argv[1]
LIB = 'ccd/history/lib.mjs'
CASE = ("    case 'lag-high': {   // R6: on a held node, the hold's own remedy, through remedyFor so it stays single-sourced\n"
        "      const hold = lagHoldOf(h);\n"
        "      return hold === null\n"
        "        ? HEALTH_REMEDIES['lag-high']\n"
        "        : `no scheduled pass ingests while ${hold} stands, so this lag cannot drain until it clears: ${remedyFor(hold, h)}`;\n"
        "    }\n")
R6 = 'D-5027, R6'
M = [
 ('M1a the lag-high case deleted (pure)', LIB, CASE, '', 'test/history-lib.test.ts', R6),
 ('M1b the lag-high case deleted (end to end)', LIB, CASE, '', 'test/history-op.test.ts', r'F2 \(review 466\)'),
 ('M2 the schema-newer branch dropped', LIB, "  if (schemaNewerOf(h)) return 'schema-newer';\n", '', 'test/history-lib.test.ts', R6),
 ('M3 the hold text returned unconditionally', LIB, '      return hold === null\n', '      return false\n', 'test/history-lib.test.ts', R6),
 ('M4 schema-newer ordered after the migration verdict', LIB,
  "  if (schemaNewerOf(h)) return 'schema-newer';\n  if (h.migration === 'snapshot-needs-op') return 'migration-needs-op';\n",
  "  if (h.migration === 'snapshot-needs-op') return 'migration-needs-op';\n  if (schemaNewerOf(h)) return 'schema-newer';\n",
  'test/history-lib.test.ts', R6),
 ('M5 at-cap counted as a hold (R6 says it is not)', LIB,
  "  if (h.migration === 'refuse-low-disk') return 'migration-refused';\n  return null;\n",
  "  if (h.migration === 'refuse-low-disk') return 'migration-refused';\n  if (h.capturePause === 'at-cap') return 'at-cap';\n  return null;\n",
  'test/history-lib.test.ts', R6),
 ('M6 the hold remedy read from the fallback table, not remedyFor', LIB,
  'until it clears: ${remedyFor(hold, h)}`;', 'until it clears: ${HEALTH_REMEDIES[hold]}`;', 'test/history-lib.test.ts', R6),
]
def run(test, filt):
    p = subprocess.run(['./node_modules/.bin/vitest', 'run', test, '-t', filt], cwd='server', capture_output=True, text=True)
    tally = next((l.strip() for l in p.stdout.splitlines() if l.strip().startswith('Tests ')), '?')
    return p.returncode, tally
for name, rel, old, new, test, filt in M:
    keep = os.path.join(KEEP, os.path.basename(rel))
    if os.path.exists(keep):
        sys.exit(f'refusing: {keep} is left from a killed run; restore it with: cp {keep} {rel} && rm {keep}')
    shutil.copyfile(rel, keep)
    try:
        s = open(rel, encoding='utf8').read()
        assert s.count(old) == 1, (name, s.count(old))
        open(rel, 'w', encoding='utf8').write(s.replace(old, new))
        red = run(test, filt)
    finally:
        shutil.copyfile(keep, rel)
        os.remove(keep)
    ok = run(test, filt)
    print(f'{name}: mutant rc {red[0]} ({red[1]}), restored rc {ok[0]} ({ok[1]})')
EOF
python3 "$SCRATCH/t5-mutants.py" "$SCRATCH/keep"
ls -A "$SCRATCH/keep"
git diff --stat -- ccd/history/lib.mjs
```

Expected: seven lines, each `mutant rc 1 (…), restored rc 0 (…)`, then an empty listing, and the diff stat unchanged from Step 6. Each mutant's red was measured at `bd363a76b`; the skipped counts differ on the worker's tree.
- **M1a:** `5 failed | 3 passed`, the four `HOLDS` rows and the combined row. `expected 'read the sweep: journalctl --user -u …' to be 'no scheduled pass ingests while migra…'`.
- **M1b:** `1 failed`, the F2 case end to end, with the same message.
- **M2:** `3 failed | 5 passed`: both schema-newer `HOLDS` rows (`expected 'read the sweep: …' to be 'no scheduled pass ingests while schem…'`) and the combined row (`expected 'no scheduled pass ingests while migra…' to contain 'while schema-newer stands'`).
- **M3:** `3 failed | 5 passed`: the CONTROL and both capture-pause rows, `expected 'no scheduled pass ingests while null …' to be 'read the sweep: journalctl --user -u …'`.
- **M4:** `1 failed | 7 passed`: the combined row, `expected 'no scheduled pass ingests while migra…' to contain 'while schema-newer stands'`.
- **M5:** `1 failed | 7 passed`: the at-cap row, `expected 'no scheduled pass ingests while at-ca…' to be 'read the sweep: journalctl --user -u …'`.
- **M6:** `1 failed | 7 passed`: the `refuse-low-disk` row. The fallback text lacks the computed byte count, so the two `no scheduled pass ingests while migra…` strings differ (`Object.is equality`).

If any line reads `mutant rc 0`, that guard is unpinned: report it, and never weaken the guard. Then run Step 7's first two commands once more: green.

- [ ] **Step 9: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'lag-high')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Expected: green. Measured at `bd363a76b` with this task alone:
- `history-op`: `108 passed`, about 62 s. That includes D-5027's describe (`6 passed` under `-t 'D-5027'`) and its F1 case, where `schema-newer` stands beside `tick-stale` with its own remedy.
- `ccrc-doctor -t 'lag-high'`: `2 passed`. Its `lag-high` rows assert no remedy text.
- `ccrc-doctor -t 'history'`: `123 passed`, plus the rows wave 5h-1 and this plan's earlier tasks add.
- `single-definition -t 'ccrc history'`: `92 passed`. No vocabulary was added, and `HEALTH_REMEDIES` still names exactly the warn and fail words.

- [ ] **Step 10: Commit.**

```bash
git add ccd/history/lib.mjs server/test/history-lib.test.ts server/test/history-op.test.ts
git commit -m "fix(history): lag-high's remedy on a held node is the hold's own, schema-newer first (W5h-2 Task 5, D-5027 follow-up, R6)"
```

### Task 6: the errata, the spec, and the whole-PR checks

**Files:**
- Modify: `server/test/single-definition.test.ts`, one word on one comment line: `512-character` in `// The delegation spool's jq definitions (#448) spell its own 512-character path bound, …` (`:6846` at bd363a76b), inside the case `HISTORY_CARD_MAX is CARD_LINE_MAX, and the read and the reserve are spelled from it, never as 512 or 513` (`:6842`). The assertion below it (`x.replace('def maxpath: 512;', '')`) is not touched.
- Modify: `server/test/session-hook.test.ts`, the comment over the PARITY table's two FIFO rows: the five lines from `    // return 0\`. The guards' only unique work is a non-regular file: …` to `    // These rows run bounded (the FIFO runner below), …` (`:12625-12629` at bd363a76b), rewrapped inside those same five lines. Its first line (`:12624`, `// D-5063 (review 495 F1, …`) and the rows (`:12630-12631`) are not touched.
- Modify: `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md`, in place, one clause each: Task 9's `.generation` bullet (`:4934`) and the body of D-5063's entry (`:7392`); its head `- **D-5063** — \`history-card-unusable-generation-withholds\`` is kept. The sibling sentence at `:4935` ("a FIFO the probe would block on") is not edited (see Choices).
- Modify: `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md`, in place, inside two existing entries: D-5022 (`:38292`, three clauses) and D-5027 (`:38297`, one residual appended after its residual (c)). No D-number is added, removed or renumbered.
- Modify: `server/test/history-maint.test.ts`, comment lines only, in the block over the cap pins (`// The cap pinned exactly, from both sides (D-5022, …`): `:666` (`// cap, never on a pipe's size or on timing: …`), `:670` (`//     flushes it (lower side: …`) and `:677` (`// exactly one, so the bytes received are the bytes written plus that one.`), at bd363a76b. Task 3 adds its relay pins to this file first; these lines are re-anchored by content.
- Modify: `ccd/history/lib.mjs`, a comment only: the D-5027 comment above `const heldFresh =` inside `deriveHealth` (`:3601-3608` at bd363a76b; the edit appends to its last line, `  // refuse-newer arm is defensive on a scheduled pass.`). Wave 5h-1 edits `deriveHealth`'s FAIL block and this plan's Task 5 edits `remedyFor`: this is a separate hunk, anchored by its own text, and depends on no 5h-1 name.
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, in place: §9.6's `lag-high` bullet (`:2258` at bd363a76b), one sentence for Task 5; and, only if §17 "Revision history" (`:3468`) on the worker's base carries a line for wave 5h-1, one §17 line for this wave. Every other spec edit of this plan is made by the task that owns its departure, in that task's commit: §8.3 by Task 1 (D-5745), §6.2 by Task 2 (D-5746), §8.4 by Task 3 (D-5747), §9.4's `history-store-id` row and §9.6's `op-running` bullet by Task 4 (D-5748, with the 86 B erratum). This task only checks that Task 4's §9.4 tokens are there. Wave 5h-1 amends §6.1, §8.4's "Carry before the verb" bullet, §9.2, §9.6's FAIL and WARN lists after `export-overdue` and `export-segment-missing`, §9.10, §9.14 and §9.15: none of those sentences is edited here.
- Read, no edit: `README.md`'s `### Session history: lossless recall (\`ccrc history\`)` section (`:5518` at bd363a76b); `shared/lifecycle.ts`'s `history-store-id` entry (`:64-65`, Task 4's); `CLAUDE.md`.
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w5h2/pr-body.md`.

Every anchor was measured at bd363a76b. Wave 5h-1 and Tasks 1–5 edit `lib.mjs`, `history-maint.test.ts` and the spec first, so every edit below is anchored by its content, and each script asserts that its anchor occurs exactly once.

**Interfaces:**
- Consumes (names this task's text states; Step 1 checks each exists, and never defines one):
  - Task 1: the field arm of `contextRules`' named value class, `BASE_RULES` and the composed doors (R11), with the test seam `redactDoorReadings(door)`;
  - Task 2: `BELT_VERSION = 2` and the owed hit `composeDoor` counts under `idx.beltAll`, through `beltHit`;
  - Task 3: `RELAY_LOOKBEHIND_BYTES = 16384` and `redactAfter(lookBehind: string, text: string, idx) -> { emit: string, keep: string }`, with `opRelay` and `runOpVerb` keeping one window per source stream;
  - Task 4: `formatOpMarker({ verb, pid, startMs, procStart, bootId })`, `parseOpMarker(text)` (answering `{ verb, pid, startMs, procStart, bootId }`, the legacy three-field form with `procStart` and `bootId` null), `decideOpLive(marker, measured)`, `shared/lifecycle.ts`'s `history-store-id` tier (the op bound and `at most 86 B`), and the spec §9.4 row's cells Task 4 wrote (`` `op` (about 77 B, at most 119 B; W5h-2, D-5748) ``, `` `pass` (about 70 B, at most 86 B) `` and `` an `op` that names no live pass, a dead or reused pid's, is removed by the next pass, §9.6 and D-5748; ``), together with D-5016's 86 B erratum in the B2 plan;
  - Task 5: `lag-high`'s held remedy, with `HEALTH_REMEDIES['lag-high']` unchanged as the default text;
  - this plan's D-5745 (Task 1), D-5746 (Task 2), D-5747 (Task 3) and D-5748 (Task 4), each defined once in "Deviations found", written with the plan; the existing D-4613, D-5016, D-5021, D-5022, D-5026, D-5027 and D-5063, cited bare.
- Produces: text only. No code path changes, no export, no test case and no fixture. The §9.6 `lag-high` sentence (and the conditional §17 line), the B2 and B3 plans' errata, four comments (`single-definition`, `session-hook`, `history-maint`, `lib.mjs`), and the PR body file.

**Spec:**
- Edited here: §9.6's `lag-high` bullet; §17 only under the condition above. Read and checked, not edited: §9.4's `history-store-id` row (Task 4's), §9.6's `tick-stale` held-pass rule at `:2257`, and §9.12 (rollout through the release lane only), which the PR body cites.
- Departures: this task defines no number. It cites D-5747 in the B2 plan's D-5022 entry and the `history-maint` comment it corrects for Task 3, D-5027 bare in the §9.6 sentence, and D-5745, D-5746, D-5747 and D-5748 one by one in the conditional §17 line. The errata take no number: B3's two and B2's two are prose and comment corrections of merged text (the scope found none needs one), and D-5027's window stays text under R7.
- Choices this task makes:
  - **Line-neutral where the file is hot.** `single-definition.test.ts` (35 commits since 2026-10-12) changes one word. `session-hook.test.ts`'s comment is rewrapped inside its own five lines (widest line 141 characters; the file already holds comment lines that wide and wider), so no line below it moves. The B3 plan's two edits stay inside their one-line paragraphs. Nothing cites any of the three files by a line inside or below the edits (the scope measured it; the compaction-card citation corpus cites `session-hook.test.ts` only below `:9100`).
  - **The B3 ruling's list, exactly.** The ruling names Task 9's bullet (`:4934`) and D-5063. `:4935`'s sibling sentence ("a FIFO the probe would block on") is not edited; extending the parenthesis there is the coordinator's reading, and the PR body says so.
  - **Not ours.** The delegation spool's own test calls its bound "512 characters" (`delegation-spool.test.ts:1349` at bd363a76b), which holds there only because its padding is single-byte; that file belongs to another programme, so it is named in the PR body and not edited.
  - **B2-5 (a), worded after Task 3.** D-5022's `(1 << 20) - 1` claim is scoped to the read split it depends on (simulated over the relay's own byte arithmetic in the wave's scope, at e4936efab: that cap reds the no-line-break over-the-cap case's byte count only when a read ends exactly at byte 1,048,576), and "never on a pipe's size or on timing" is said of what it is true of (the spill and the green cases). Both D-5022 and `history-maint`'s comment also say that Task 3's window (D-5747) now carries the spill and the close, in the order Task 3's relay reads a text: alone first, then with its stream's look-behind; the four cap pins staying green on this PR's tree is the measurement behind "these counts stand".
  - **B2-5 (b), text only (R7).** The stale-stamp window is written in two places: `lib.mjs`'s D-5027 comment, beside `heldFresh`, which is the code it describes; and D-5027's entry in the B2 plan, as residual (d). Spec §9.6 already states it (`:2257`: "a stamp written before a store became newer still holds `tick-stale` back for up to 10 min, a bounded residual (review 467 F3)"), so the spec is not edited for it. No `heldFresh` guard and no residual pin are added.
  - **§9.4's row is Task 4's.** Task 4 owns `shared/lifecycle.ts`'s tier, the spec row, D-5016's entry and the 87-to-86 erratum (B2's item 5 (c)). Step 8 writes nothing there: it checks the exact tokens Task 4's Step 11 wrote, and a missing token is a finding against Task 4, reported, never written here.
  - **`lag-high` in §9.6.** Task 5 takes no number and the spec never spelled the remedy, but §9.6's `lag-high` bullet already discusses a held node, so one sentence says what the remedy now names, citing D-5027 bare (R6).
  - **What is left as written.** The spec's rev-3.6 revision-history line (`:3551`, "Errata carried to the next code wave") and the stale "B3's" pointers for B2's item 6 (`derive.mjs:502`, `history-derive.test.ts:1467`) stay as history: R9 keeps item 6 Later, and neither is in this task's list. There is no rev bump; sentences are amended in place, as wave 5h-1's were. §17 gains one line for this wave only if the base's §17 carries one for wave 5h-1 (Step 8 measures it; at bd363a76b, and in 5h-1's plan, there is none, so the expected outcome is no §17 edit).
  - **README is not edited** (Step 9 measures it).

- [ ] **Step 1: Measure what the text will state.** Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa` (the hot files are `single-definition.test.ts`, `session-hook.test.ts`, `ccd/history/lib.mjs` and the history tests). Then, from the repository root:

```bash
grep -nE '^export const BELT_VERSION = 2;$' ccd/history/lib.mjs
grep -nE '^export const RELAY_LOOKBEHIND_BYTES = ' ccd/history/lib.mjs
for f in redactDoorReadings redactAfter formatOpMarker parseOpMarker decideOpLive; do
  printf '%s %s\n' "$f" "$(grep -cE "^export function $f\(" ccd/history/lib.mjs)"; done
grep -c 'at most 86 B' shared/lifecycle.ts
grep -c 'at most 87 B' shared/lifecycle.ts
grep -nF "'lag-high': \`read the sweep: \${SWEEP_LOG}; a backlog drains within each run's budget" ccd/history/lib.mjs | cut -d: -f1
for d in D-5745 D-5746 D-5747 D-5748; do
  printf '%s %s\n' "$d" "$(grep -c "^- \*\*$d\*\* — " docs/superpowers/plans/2026-10-19-ccrc-history-w5h2-redaction-and-ops.md)"; done
```

Expected:
- one `BELT_VERSION = 2` line;
- one `RELAY_LOOKBEHIND_BYTES` line whose value is 16,384 (spelled `16384`, `16 * 1024`, `1 << 14` or `2 ** 14`);
- each of the five functions `1`;
- `at most 86 B` at least `1`, then `0` for `at most 87 B`;
- one line number for `lag-high`'s default remedy, unchanged;
- each of the four numbers `1`.

A value that differs from what a task's own text states (another constant, another field order), or a name or a definition that is missing, is a finding against the task that owns it: report it to the coordinator, and never write it here. The text this task writes (Steps 2, 5 and 8) states only what these measurements show.

- [ ] **Step 2: Correct B3's two errata.** From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    out = s.replace(old, new)
    assert out.count('\n') == s.count('\n'), (rel, 'line count moved')
    open(rel, 'w', encoding='utf8').write(out)
    print('edited', rel)
B3 = 'docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md'
FIFO = 'only a FIFO (or a device node, which only root can plant) changes the verdict'
# B3 #1: the spool's path bound is bytes (one word, one line)
sub('server/test/single-definition.test.ts',
"""    // The delegation spool's jq definitions (#448) spell its own 512-character path bound, `def maxpath: 512;`, a different
""",
"""    // The delegation spool's jq definitions (#448) spell its own 512-byte path bound, `def maxpath: 512;`, a different
""")
# B3 #2 (a): Task 9's `.generation` bullet
sub(B3,
"""drop either and only a FIFO changes the verdict, because the seed would withhold an unreadable file too (at runtime""",
f"""drop either and {FIFO}, because the seed would withhold an unreadable file too (at runtime""")
# B3 #2 (b): D-5063's body; its head `- **D-5063** — ` is untouched
sub(B3,
"""drop either and only a FIFO changes the verdict, because the seed would withhold an unreadable file too (the seed is""",
f"""drop either and {FIFO}, because the seed would withhold an unreadable file too (the seed is""")
# B3 #2 (c): the FIFO rows' comment, rewrapped inside its own five lines
sub('server/test/session-hook.test.ts',
"""    // return 0`. The guards' only unique work is a non-regular file: drop either and only a FIFO changes the verdict, because the
    // seed would withhold an unreadable file too (the probes' `x=.`). A FIFO present at `_ct_read`'s `-f` test is refused there, so
    // the probe's `<` never opens it; without the guards it would block, SessionStart(compact) would hang to the hook timeout and the
    // whole compact card be lost. The tests are builtin, so one swapped in after the test still blocks, a window no row can measure.
    // These rows run bounded (the FIFO runner below), so a dropped guard reds on the bound, not by wedging.
""",
"""    // return 0`. The guards' only unique work is a non-regular file: drop either and only a FIFO (or a device node, which only root can
    // plant) changes the verdict, because the seed would withhold an unreadable file too (the probes' `x=.`). A FIFO present at `_ct_read`'s
    // `-f` test is refused there, so the probe's `<` never opens it; without the guards it would block, SessionStart(compact) would hang to
    // the hook timeout and the whole compact card be lost. The tests are builtin, so one swapped in after the test still blocks, a window no
    // row can measure. These rows run bounded (the FIFO runner below), so a dropped guard reds on the bound, not by wedging.
""")
EOF
wc -l server/test/single-definition.test.ts server/test/session-hook.test.ts docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md
grep -c 'only a FIFO changes the verdict' docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md server/test/session-hook.test.ts
grep -c 'which only root can plant) changes the verdict' docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md
grep -c '512-character' server/test/single-definition.test.ts
grep -c '^- \*\*D-5063\*\* — `history-card-unusable-generation-withholds`' docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md
```

Expected: four `edited` lines (the script also asserts that no file's line count moved); the three line counts equal to the same command run before the script (measured at bd363a76b: 7220, 13099 and 7395, the same after); `0` for each of the two files; `2`; `0`; `1` (D-5063's head kept). Measured at bd363a76b on a scratch copy: the four edits applied, the rewrapped lines are 136, 141, 140, 141 and 125 characters wide, and no other line of either test file moved.

- [ ] **Step 3: Run the cases that hold the touched text green.** The edits are comments and plan prose, so no case reads them; these runs prove the files still load and the rows the comment describes still pass. In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'HISTORY_CARD_MAX is CARD_LINE_MAX')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'parity: a FIFO')
```

Expected, measured at bd363a76b on a scratch copy with Step 2 applied: `Tests  1 passed | 755 skipped (756)` and `Tests  2 passed | 707 skipped (709)`. The second filter selects exactly the two FIFO rows (`C19/C68 (card half), recall-off parity: a FIFO .generation is unusable: …` and `… a FIFO generation record is no record: …`). Skipped counts grow with Tasks 1–5.

No mutant applies to a comment or to plan prose. The behaviour the text describes keeps its existing pins, which this task does not re-run as mutants: the delegation spool's byte bound (`delegation-spool.test.ts`' `def maxpath: (\d+);` pin and its 170- and 171-euro-sign cases) and the two FIFO guards (D-5063's mutants `FR3-M59` and `FR3-M60`). A device node needs root to plant, which is the ruling's point, so no fixture-HOME row can plant one and none is added.

- [ ] **Step 4: Commit B3's errata.**

```bash
git add server/test/single-definition.test.ts server/test/session-hook.test.ts docs/superpowers/plans/2026-10-07-ccrc-history-w1-b3-card-line.md
git commit -m "docs(history): B3's errata: the spool's path bound is 512 bytes, and a device node, which only root can plant, changes the FIFO verdict too (wave 5h-2 Task 6)"
```

- [ ] **Step 5: Correct B2's errata (a) and state the stale-stamp window (b) as text.** After Task 3, whose relay this wording describes. From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)
B2 = 'docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md'
# (a) D-5022's mutant claim, scoped to the read split it depends on
sub(B2,
"""`1 << 16`, `(1 << 20) - 1`: both at-the-cap cases and the no-line-break over-the-cap case (on its byte count);""",
"""`1 << 16`, `(1 << 20) - 1`: both at-the-cap cases and the no-line-break over-the-cap case (on its byte count; for `(1 << 20) - 1` only when a read ends exactly at byte 1,048,576, corrected by wave 5h-2's errata from a simulation of the relay's own byte arithmetic: 64 KiB and 4 KiB reads red it, 65,535-byte reads and one whole read leave it green, so that mutant's red rests on the two at-the-cap cases);""")
# (a) D-5022's "never on timing", said of what it is true of
sub(B2,
"""never on a pipe's size or on timing (the shim cannot touch its marker until the CLI has accepted every byte).""",
"""never on a pipe's size or on timing (the shim cannot touch its marker until the CLI has accepted every byte; a claim about the spill and the green cases, never about a mutant's byte-count red, which can depend on how the reads split the stream, as corrected below by wave 5h-2's errata).""")
# (a) D-5022's residual, closed by Task 3's window (D-5747)
sub(B2,
"""the coordinator puts a per-stream look-behind window on B3's list.""",
"""the coordinator puts a per-stream look-behind window on B3's list. Wave 5h-2 ships that window (D-5747): each text a SOURCE stream relays, stderr's spill past the cap included, is first redacted alone and then, keeping those marks, together with the last `RELAY_LOOKBEHIND_BYTES` (16 KiB) of the same stream before it, and that reading is unioned with the text read one line at a time (lib's `redactAfter`), so a JSON value on the line after its key and a PEM body after its BEGIN line are masked on stdout too; a shape longer than the window, and text printed before its key line arrived, stay residual.""")
# (b) D-5027's stale-stamp window, text only (R7): residual (d)
sub(B2,
"""(c) the stamp is a wall-clock read, so a clock step back that is within `PASS_FUTURE_SLACK_MS` reads fresh for that long.""",
"""(c) the stamp is a wall-clock read, so a clock step back that is within `PASS_FUTURE_SLACK_MS` reads fresh for that long; (d) the stale-stamp window (review 467 F3, kept as text by its ruling and by wave 5h-2's R7, so `heldFresh` gains no guard): a `held_pass_ms` stamped before the store became newer still reads fresh, so `schema-newer` shows without `tick-stale` for up to `TICK_STALE_MS` after that stamp (measured in wave 5h-2's scope: a store at `user_version` 3 under code version 2, a stamp 1 min old and a last tick 40 min old give `lag-high` and `schema-newer` and no `tick-stale`); spec §9.6 states the same window.""")
# (b) the same window, beside the code it is about
sub('ccd/history/lib.mjs',
"""  // database and stamps nothing (DM17: no write on a newer store), so tick-stale keeps standing beside schema-newer; planRun's
  // refuse-newer arm is defensive on a scheduled pass.
""",
"""  // database and stamps nothing (DM17: no write on a newer store), so tick-stale keeps standing beside schema-newer; planRun's
  // refuse-newer arm is defensive on a scheduled pass. One window stays, as text only (review 467 F3; wave 5h-2's R7): heldFresh
  // reads no schema verdict, so a held_pass_ms stamped before the store became newer still reads fresh, and tick-stale is held
  // back beside schema-newer for up to TICK_STALE_MS after that stamp (spec §9.6; D-5027's residual (d) in the B2 plan).
""")
# (a) history-maint's cap comment: "never on timing" scoped, the read-split red named, and Task 3's window (D-5747)
M = 'server/test/history-maint.test.ts'
sub(M,
"""  // cap, never on a pipe's size or on timing: a hold is spilled once its byte count is OVER the cap (`errBytes > ERR_HOLD_CAP`), and
""",
"""  // cap, never on a pipe's size or on timing (a claim about the spill and every green case below; one mutant's red on a byte count
  // is not, see the lower side): a hold is spilled once its byte count is OVER the cap (`errBytes > ERR_HOLD_CAP`), and
""")
sub(M,
"""  //     flushes it (lower side: red for any cap below 1,048,576, so `1 << 16`, `(1 << 20) - 1`, and a comparison `>=`).
""",
"""  //     flushes it (lower side: red for any cap below 1,048,576, so `1 << 16`, `(1 << 20) - 1`, and a comparison `>=`). The cap
  //     `(1 << 20) - 1` also reds the no-line-break over-the-cap case on its byte count, but only when a read ends exactly at byte
  //     1,048,576 (64 KiB and 4 KiB reads do; 65,535-byte reads and one whole read do not), so its red rests on these two cases.
""")
sub(M,
"""  // exactly one, so the bytes received are the bytes written plus that one.
""",
"""  // exactly one, so the bytes received are the bytes written plus that one. Since wave 5h-2 (D-5747) the spill and the close write
  // through the stream's look-behind window (`redactAfter`: the text alone, then with the last RELAY_LOOKBEHIND_BYTES of the stream,
  // unioned with each line read alone), which changes no byte of a text no rule masks, so these counts stand as they were.
""")
EOF
node --check ccd/history/lib.mjs && echo 'lib.mjs parses'
grep -c "for \`(1 << 20) - 1\` only when a read ends exactly at byte 1,048,576" docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md
grep -c '(d) the stale-stamp window (review 467 F3' docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md
grep -c 'One window stays, as text only (review 467 F3' ccd/history/lib.mjs
grep -c 'Since wave 5h-2 (D-5747) the spill and the close write' server/test/history-maint.test.ts
```

Expected: eight `edited` lines (four for the B2 plan, one for `lib.mjs`, three for `history-maint.test.ts`, in that order), `lib.mjs parses`, then `1` four times. The B2 plan's line count does not move (each edit stays inside its one-line entry); `lib.mjs` gains two lines and `history-maint.test.ts` five, all comment lines. Measured at bd363a76b on a scratch copy: every anchor unique, every edit applied, and those line counts (8600 to 8602, 2837 to 2842).

What each sentence now says:
- **D-5022, the mutant list.** Old: `` `1 << 16`, `(1 << 20) - 1`: both at-the-cap cases and the no-line-break over-the-cap case (on its byte count); ``. New: the same, with the byte-count red scoped, for `(1 << 20) - 1`, to a read that ends exactly at byte 1,048,576, and its red said to rest on the two at-the-cap cases.
- **D-5022, "never on timing".** Old: `` never on a pipe's size or on timing (the shim cannot touch its marker until the CLI has accepted every byte). ``. New: the same parenthesis, plus "a claim about the spill and the green cases, never about a mutant's byte-count red".
- **D-5022, its residual.** Old: `` the coordinator puts a per-stream look-behind window on B3's list. ``. New: the same, then the window wave 5h-2 ships (D-5747) and its two residuals.
- **D-5027, residual (d).** Appended after residual (c): the stale-stamp window, kept as text by review 467's ruling and R7, with its measurement.
- **`lib.mjs`'s D-5027 comment.** Appended after `refuse-newer arm is defensive on a scheduled pass.`: the same window, beside `heldFresh`, pointing at spec §9.6 and D-5027's residual (d).
- **`history-maint.test.ts`.** `:666`'s "never on a pipe's size or on timing" is said of the spill and every green case; `:670` gains the read-split note on `(1 << 20) - 1`; `:677` gains that the spill and the close write through Task 3's window, which changes no byte of a text no rule masks.

- [ ] **Step 6: Run the cases those comments sit beside green.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5027')
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'the hold is bounded at exactly 1 MiB')
```

Expected, measured at bd363a76b on a scratch copy with Step 5 applied: `Tests  4 passed | 1079 skipped (1083)` and `Tests  4 passed | 114 skipped (118)`; skipped counts grow with Tasks 1–5. On this PR's tree the first filter also selects Task 5's eight cases, which sit in a describe nested inside D-5027's, so it reads `12 passed` (predicted: 4 plus Task 5's 8, plus any D-5027 case 5h-1 adds). On this PR's tree the second run is the measurement behind `:677`'s new sentence: the four exact-cap cases, which count every byte, still pass with Task 3's window in the spill and the close. A red there is a finding against Task 3: report it, and never edit the comment or a byte count to fit.

No mutant applies: Step 5 changes no code, and R7 rules that the window gets no guard.

- [ ] **Step 7: Commit B2's errata.**

```bash
git add docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md ccd/history/lib.mjs server/test/history-maint.test.ts
git commit -m "docs(history): B2's errata: D-5022's (1 << 20) - 1 claim scoped to the read split and its residual closed by the relay window, D-5027's stale-stamp window stated as text (R7) (wave 5h-2 Task 6)"
```

- [ ] **Step 8: The spec: Task 5's one sentence, a check of Tasks 1–4's sentences, and §17 only if 5h-1 wrote there.** Tasks 1–4 each amended their own spec sentences in their own commits (§8.3 D-5745, §6.2 D-5746, §8.4 D-5747, §9.4 and §9.6 D-5748); this step never rewrites one of them. It does three things:
  - **§9.6 `lag-high`** (`:2258`), written here. Old: `` A capture pause an earlier pass left (`at-cap`, `capture-paused-low-disk`) also stands beside the hold's FAIL; ``. New: the same, then: on a node held at `schema-newer`, `migration-needs-op` or `migration-refused`, the remedy names that hold, `schema-newer` first, and gives its remedy; a capture pause is not such a hold (D-5027's follow-up, cited bare; R6; no number).
  - **§9.4 `history-store-id`** (`:2162`), checked, never written: B2's item 5 (c) is Task 4's (its Step 11 (b)). The row must hold exactly the tokens Task 4 wrote, `` `op` (about 77 B, at most 119 B; W5h-2, D-5748) ``, `` `pass` (about 70 B, at most 86 B) `` and `` an `op` that names no live pass, a dead or reused pid's, is removed by the next pass, §9.6 and D-5748; ``, and no `at most 87 B` and no `` a dead pid's `op` is removed ``. The B2 plan's D-5016 entry must hold Task 4's ` Erratum (wave 5h-2, review 467 F4): the longest marker the grammar takes is 86 B`. A missing token is a finding against Task 4: report it, and write nothing here.
  - **§17 "Revision history"**, conditional. If the base's §17 carries a line for wave 5h-1 (`grep -nE '5h-1|W5h-1' ` over §17 finds one), append one line after it in the same style for wave 5h-2, naming D-5745 (§8.3), D-5746 (§6.2), D-5747 (§8.4) and D-5748 (§9.4, §9.6) one by one, and the §9.6 `lag-high` sentence (D-5027's follow-up). If it finds none, §17 is not edited (measured at bd363a76b and in 5h-1's plan: none).

From the repository root:

```bash
wc -l docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
grep -nE '(lib|cli|sweep|store|derive)\.mjs:[0-9]' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md | wc -l
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)
def must_hold(rel, need, gone, where, row=None):
    # Checks only: these tokens are another task's text, so a miss is a finding against that task and nothing is written.
    # With `row`, only the one line that starts with it is read (§17's rev-3.6 line still quotes "at most 87 B", as history).
    s = open(rel, encoding='utf8').read()
    if row is not None:
        lines = [l for l in s.split('\n') if l.startswith(row)]
        assert len(lines) == 1, (rel, where, 'rows', len(lines))
        s = lines[0]
    missing = [t for t in need if t not in s]
    left = [t for t in gone if t in s]
    assert not missing and not left, (rel, where, 'missing', missing, 'still there', left)
    print('checked', where)
SPEC = 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md'
B2 = 'docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md'
# §9.4 history-store-id and D-5016's entry: Task 4's text (B2's item 5 (c)), checked, never written here
must_hold(SPEC, [
    "`op` (about 77 B, at most 119 B; W5h-2, D-5748)",
    "`pass` (about 70 B, at most 86 B)",
    "an `op` that names no live pass, a dead or reused pid's, is removed by the next pass, §9.6 and D-5748;",
], ['at most 87 B', "a dead pid's `op` is removed"], 'spec §9.4 history-store-id (Task 4)', row='| `history-store-id` |')
must_hold(B2, [' Erratum (wave 5h-2, review 467 F4): the longest marker the grammar takes is 86 B, not 87 B;'], [], "D-5016's erratum (Task 4)")
# Tasks 1-4's own sentences are in place (each task's commit), and their old sentences are gone
must_hold(SPEC, ['D-5745', 'D-5746', 'D-5747', 'D-5748', 'Which rows a belt generation rewrites'],
          ['The CLI relays stdout line by line', '<verb> <pid> <start_ms>` there'], 'Tasks 1-4 spec sentences')
# §9.6 lag-high: its remedy names a standing hold (Task 5, D-5027's follow-up; R6, no number)
sub(SPEC,
"""A capture pause an earlier pass left (`at-cap`, `capture-paused-low-disk`) also stands beside the hold's FAIL;
""",
"""A capture pause an earlier pass left (`at-cap`, `capture-paused-low-disk`) also stands beside the hold's FAIL. On a node held at `schema-newer`, `migration-needs-op` or `migration-refused`, `lag-high`'s remedy names that hold, `schema-newer` first when two stand, and gives the hold's own remedy, because the lag cannot drain until the hold clears (wave 5h-2, D-5027's follow-up, R6); a capture pause is not such a hold, keeps its own line, and leaves `lag-high`'s backlog remedy as it was;
""")
# §17: is there a line for wave 5h-1? Only then does this wave get one (written by hand below, never by this script).
s = open(SPEC, encoding='utf8').read()
at = s.find('\n## 17. Revision history')
assert at != -1, 'no §17 heading'
hits = [l for l in s[at:].split('\n') if '5h-1' in l]
print('§17 5h-1 lines:', len(hits))
EOF
wc -l docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
for d in D-5745 D-5746 D-5747 D-5748; do printf '%s %s\n' "$d" "$(grep -c "$d" docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md)"; done
grep -c "a dead pid's \`op\` is removed\|<verb> <pid> <start_ms>\` there\|The CLI relays stdout line by line" docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
grep -nE '(lib|cli|sweep|store|derive)\.mjs:[0-9]' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md | wc -l
```

Expected: the line count and the `file.mjs:N` count before the script; then `checked spec §9.4 history-store-id (Task 4)`, `checked D-5016's erratum (Task 4)`, `checked Tasks 1-4 spec sentences`, one `edited` line (the §9.6 `lag-high` sentence) and `§17 5h-1 lines: N`; the same line count after (the edit stays inside its own line); then each number counted at least once (`grep -c` counts lines; D-5745 1, D-5746 2 and D-5747 1, measured on `bd363a76b`'s spec with Tasks 1–3's sentences applied, and D-5748 2 predicted from Task 4's text, the §9.4 row being one line); then `0` (no old sentence left); then the same `file.mjs:N` count as before (the new sentence adds none). An assertion that fails in a `checked` line is a finding against the task that owns the text: report it to the coordinator, and edit nothing.

If `§17 5h-1 lines` is 0 (the expected case: none at bd363a76b, and 5h-1's plan adds none), §17 is not edited. If it is 1 or more, read those lines and, directly after the last of them, add ONE line in their style for wave 5h-2 that names D-5745 (§8.3, the named value read whole in a field), D-5746 (§6.2, `BELT_VERSION` 2 and the hit-only rewrite), D-5747 (§8.4, the relay's look-behind window) and D-5748 (§9.4 and §9.6, the op marker's identity and the 86 B erratum) one by one, plus §9.6's `lag-high` sentence (D-5027's follow-up, R6). Then the spec's line count is one more than before, and each of the four numbers counts one more.
- No test reads the spec: the history tests name it only in header comments, by section.
- The §6.2 and §9.6 bold labels are kept, so the `§6.2 "The belt"` and §9.6 citations in test headers still resolve.
- If Step 1 measured a value other than the one a task's own spec sentence states (the window, the op bound, the field order), that is a finding against the task that wrote the sentence: report it to the coordinator, and never edit that sentence or the code here.

- [ ] **Step 9: Check that README's history section says nothing this PR changes.** From the repository root:

```bash
sed -n '/^### Session history: lossless recall/,/^---$/p' README.md | grep -nwiE 'redact(ed|ion|s)?|relay(s|ed)?|belt|marker|lag-high|reindex(ed)?|line by line|op'
```

Expected: five lines, each about redaction in general (measured at bd363a76b: `35:` "redacts secret values before any cut", `36:` "(still redacted)", `37:` "redacted exactly prints under the line", `38:` "[window redacted alone: …]", `41:` "the first 1 MiB of each message's redacted"). None states where a context value ends, the relay's reading, the belt's version, the op marker or `lag-high`'s remedy, so README is not edited and CLAUDE.md's `README.md (~N lines)` figure stays. If another line appears (another programme's edit on `main`), read it. If it states a rule this PR changes, report it to the coordinator as a finding, quoting the line and the task whose rule it states, and do not edit README: this PR never edits it (Global Constraints, "Files this PR never edits").

- [ ] **Step 10: Commit the spec.**

```bash
git add docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git commit -m "docs(history): spec 9.6's lag-high says its remedy names a standing hold (D-5027's follow-up, R6; wave 5h-2 Task 6)"
```

- [ ] **Step 11: The whole-PR checks.** From the repository root, each line in the foreground with a timeout of at least 600000 ms, ONE tool call per line: never run two suites in one call, and never a loop over suites, because the history suites together run well past 600 s (history-maint alone is about 4 min 36 s, history-ingest about 2 min 12 s and history-op about 62 s), and a suite is never backgrounded. Re-run a red file alone before calling it a break, because CLAUDE.md names the load flakes (`session-hook` among them):

```bash
git fetch origin main
# every lib constant this PR added (not one main already had) is bound in single-definition's VOCABS
for n in $(git diff origin/main...HEAD -- ccd/history/lib.mjs | sed -nE 's/^\+export const ([A-Z_][A-Z0-9_]*) = .*/\1/p' | sort -u); do
  git show origin/main:ccd/history/lib.mjs | grep -qE "^export const $n = " && continue
  grep -qw "$n" server/test/single-definition.test.ts && echo "bound $n" || echo "UNBOUND $n"; done
git diff origin/main...HEAD -- ccd/history shared | grep -n '^+.*process\.env' || echo 'no new process.env read'
grep -n '/history-off' ccd/history/sweep.mjs ccd/history/cli.mjs || echo 'no /history-off spelling'
# a new history test file must be in ci.yml's node-floor list
git diff --name-only --diff-filter=A origin/main...HEAD -- 'server/test/history-*.test.ts' | wc -l
# every history suite alone, one tool call each: the touched ones and every other one that reads lib.mjs, cli.mjs, sweep.mjs
# or derive.mjs. First the census: 16 at bd363a76b; a suite 5h-1 added is run the same way, on a line of its own.
ls server/test/history-*.test.ts | wc -l
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-parser.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'parity: a FIFO')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/node-floor.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `bound RELAY_LOOKBEHIND_BYTES`, and one `bound` line for any other new constant, or none. `BELT_VERSION` is skipped (main already has it). An `UNBOUND` name is a finding against the task that added it (it owns the binding): report it to the coordinator, and never bind it here.
- `no new process.env read`, `no /history-off spelling`, then `0`. A non-zero count means a task created a history test file: check that it is in `ci.yml`'s node-floor heredoc and that `ci-pipeline` is green; if not, it is a finding against that task.
- The census prints 16, or 16 plus the history suites 5h-1 added, each of which then gets a line of its own like the sixteen. Every `history-*.test.ts` file green alone, `history-lib`, `history-maint`, `history-ingest`, `history-op`, `history-cli`, `history-recover` and `history-derive` among them. These hold Tasks 1–5's pins, the belt's symbolic `BELT_VERSION` pins (`history-lib`, `history-maint`, `history-ingest`, `history-recover`), the F2 cases the relay and H-32 share, and the op marker's cases.
- `lifecycle` green (Task 4's tier pin). `ccrc-doctor`'s `'history'` cases green, at least 114 selected (the B4 plan's floor). `session-hook`'s two FIFO rows green (`2 passed`), and only those two: this PR touches only their comment, and the whole file is the selection's to run.
- `single-definition`, `docs-policy`, `topology-clean`, `node-floor` and `ci-pipeline` green. tsc prints nothing.

Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. Two reds need a specific response:
- A `topology-clean` red means a new sentence names a host, an id or a private path. Rewrite that sentence; never touch the scanner.
- A `single-definition` red on a new constant or a new spelling is a finding against the task that added it: report it, and never weaken the scan.

- [ ] **Step 12: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red names a number defined in two plans: report it to the coordinator, and never renumber one yourself. This plan's numbers were issued by the allocator. D-5745, D-5746, D-5747 and D-5748 are each defined once, in this plan's `## Deviations found`, for Tasks 1, 2, 3 and 4; this task cites D-5747 in the B2 plan and a test comment (and all four in §17's line, if Step 8 wrote one), and defines none. The B2 and B3 plans' edits add no definition and remove none: D-5022's, D-5027's and D-5063's heads are as they were.

- [ ] **Step 13: Confirm the tree holds only this PR's work.** Run `git status --short`.
- It lists nothing: Steps 4, 7 and 10 committed every file of this task, and the PR body sits under the ignored `.superpowers/`.
- No step read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and no step ran `ccd`, the shim, `sweep.mjs`, `cli.mjs` or any history verb.

- [ ] **Step 14: Write the PR body, and check it and every added line for private names.** Write `.superpowers/sdd/history-w5h2/pr-body.md` with exactly the text below. Then replace its three parenthesised lines:
  - the one under `### Departures`, with this plan's `## Deviations found` list, each number as the allocator issued it, one per line;
  - the one under `### Choices the tasks made`, with every task's choice bullets, one line each, its task number first, plus any finding Steps 1 and 8 reported and the coordinator's answer to it;
  - the one under `### Tests run`, with Step 11's summary lines as printed.

Every other line is final. Use the file as the body of the wave's PR, opened the way the brief says.

```markdown
## ccrc history wave 5h-2: B2's redaction and operations hardening

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place), §6.2 "The belt", §8.3's context layer, §8.4's operator relay, §9.4's `history-store-id` row and §9.6's `op-running` and `lag-high`.
Plan: the wave 5h-2 plan this wave's brief names. It lands after wave 5h-1 (run 626): both edit `lib.mjs`'s `deriveHealth`, `HEALTH_REMEDIES` and `remedyFor` regions, in separate hunks (R8).

B2 shipped recall and the operator door; its reviews left a context value that ends too early, a relay that read stdout
one line at a time, an op marker that a reused pid keeps alive, a `lag-high` remedy blind to a standing hold, and four
errata. This PR closes those:

- a context value is read whole in a field (Task 1, D-5745): a quoted value runs to its closing quote on the same
  line (an empty one is no value); an unquoted one still ends at whitespace and the backtick, at `&` only before another
  `NAME=`, and at `,` `;` `"` `'` only before whitespace, a closer or the end of the text. `password=abc&def` and
  `PASSWORD='a b c'` are masked whole; `url?a=1&password=x&b=2` and `{"cmd":"password=x"}` keep their structure. The
  final pass's narrower class (D-4613) and the Bearer and box-token header classes are unchanged (R2);
- every redaction door reads the widened rules only over the output of the same door as the build before built it
  (R11, the coordinator's composition ruling): `redactField`, `redactFinal`, `redactFinalLines`, `redactFinalJson`,
  `redactFinalText`, `redactForIndex`, `redactForDisplay`, `entryIndexText`, `sidecarIndexText`, the display window
  and the snippet, and through them the node columns, the `--regex` child, the node fields and the relay. Every
  reading only replaces spans by the mark, decodes JSON escapes or removes escape sequences (the joined reading of
  D-4307), writing no character its input did not hold, so no door prints a value the build before masked, that is,
  one no reading of that door's output holds: by construction, and pinned by a property case through every door
  (0 of 44,422 such values printed, where the widened rules read over the raw text print 3,530) and one case that
  checks composition and subtractiveness for every door. It costs about two passes of each door (measured 1.9 to 2.0
  times on this repository's code and docs). The three patches two review rounds made to the widening, and a
  JSON-form key rule, are withdrawn with it;
- stored text is re-cleaned as a sweep phase (Task 2, D-5746): `BELT_VERSION` goes from 1 to 2, and the belt
  generation rewrites a row exactly when its composed index text differs from its rev 3.6 reading (the stored text, on
  a store a build before this one wrote; the probe's hit is that comparison), beside the rows every belt generation
  rewrites (a pair above the mark, a layer-4 or glue-window hit). Every later re-derivation, a pair-owed walk or a
  roll-forward after a rollback included, rewrites those rows again with the text they already hold. A rewrite never
  un-masks a row; it can add a term, where the new text is a decoded or sequence-free reading of the stored one (the
  residuals below). No schema change, no new meta key, no new step; grep answers throughout;
- the operator relay reads each source stream through a 16 KiB look-behind window (Task 3, D-5747): each batch is
  read alone first, and the context reading keeps those marks, so the output is never less masked than the batch
  alone; and each batch's reading is unioned with the batch read one line at a time, aligned by line (a piece the
  per-line reading does not print, on a line the reading's line breaks allow, is written as a mark), so every piece it
  writes is text the per-line reading prints, and a value a line read alone masks is written only where another line
  of the batch, read alone, prints the same characters (R4, amended by the coordinator on Task 3's measurement and on
  review finding 11; its line-aligned union accepted by the coordinator on 2026-10-19). The union also closes review
  finding 11: a JSON key and its next pair in one batch are written as one mark from the key on. Both readings use the
  composed doors, so the per-line reading masks every value the per-line relay before it masked (200,000 random
  batches, 0 printed). A property case pins it over every two- and three-line batch of JSON, `NAME:`, `NAME=`,
  colon-led, PEM and coloured fragments; a JSON value on the line after its key, or a PEM body after its BEGIN line, is masked
  on stdout too; stderr's spill past the 1 MiB cap reads through the same window;
- the op marker carries D-5016's process identity (Task 4, D-5748): `<verb> <pid> <start_ms> <proc_start> <boot_id>`,
  live only when both identity fields match; a legacy three-field marker from an older build is live only while
  `kill(pid, 0)` succeeds, EPERM reading as not live;
- `lag-high`'s remedy names a standing hold (Task 5, D-5027's follow-up): `schema-newer`, `migration-needs-op` or
  `migration-refused`, `schema-newer` first, with that hold's own remedy;
- the errata (Task 6): D-5022's `(1 << 20) - 1` claim scoped to the read split, "never on timing" said of what it is
  true of, and D-5022's residual closed by the window; D-5027's stale-stamp window written as text (R7); the op tier
  and "at most 86 B" (Task 4); `single-definition`'s "512-character" bound is 512 bytes; "only a FIFO (or a device
  node, which only root can plant) changes the verdict" in B3's plan and `session-hook`'s FIFO rows' comment; spec
  §9.6's `lag-high` sentence for Task 5 (D-5027's follow-up). Tasks 1 to 4 amend spec §8.3, §6.2, §8.4, §9.4 and
  §9.6's `op-running` in place, each in its own commit and each sentence citing its departure.

Fleet-side only: `ccd/history/*`, `shared/lifecycle.ts`'s tier text, and their tests. No schema migration (still
v2), no journal record kind, no wire change.

### Departures

(this plan's `## Deviations found` list, as issued)

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR changes no `.github/` file, so the pull request runs its selection. Check that its
   `select tests` summary lists `history-lib`, `history-maint`, `history-ingest`, `history-op`, `history-cli`,
   `history-recover`, `lifecycle`, `ccrc-doctor`, `session-hook` and `single-definition`; if one is missing,
   dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Rollout through the release lane only** (§9.12): merge, promote, then move the fleet with the update control
   plane or `ccrc rollout`. Nothing is rolled out by hand.
3. **What doctor and status say after the rollout, per node.**
   - **The belt runs once per version move.** Each store's recorded belt is version 1, so it falls due at the first
     tick and a v2 belt generation runs inside the existing re-derive slice over some ticks; `ccrc history status
     --json`'s counters gain `redact_belt_generations` once. Grep answers throughout (never exit 7), old rows serving
     until the generation rewrites them. It rewrites the rows whose index text this build writes otherwise than the
     older build stored (each comes out at least as masked as the old row: its new text is the old text read once
     more, and that reading only masks), and every row with a pair above the mark or a layer-4 or glue-window hit (a
     loaded belt value), as every belt generation does, whether or not that row's text changes.
     The cost is an estimate, never measured on a live store: on a store of about 2 GB, the scope estimated about 4 to
     13 min of CPU over about 8 to 40 ticks, roughly 0.3 to 1.3 h of wall time (measured on a 67.6 MiB-text fixture at
     2.6 MiB/s compressed); every door now reads each row twice (measured 1.9 to 2.0 times the older build's time on
     this repository's code and docs), so budget up to about twice that. The 0.69% figure (the rows of this
     repository's code and docs whose index text changes) excludes the belt-hit rows, whose share of a live store was
     not measured; a forced rewrite of every row grows the index about 1.8x
     until merged, so budget FTS growth and WAL against the disk watch, and use a belt generation the store already
     ran (`redact_belt_generations` above 0), where its time is known, as the nearest comparator. A rollback to a
     5h-1 or older build and a roll forward again each run a full walk again (the counter rises each time), so
     budget the cost and disk twice. Doctor reads as before: a belt generation has no health word.
     `doctor --repair` is the manual alternative and is not the path: it drops the index (grep exits 7 until it
     ends) and holds the lock.
   - **`lag-high` on a held node** now names the hold and gives its remedy (for example `ccrc history doctor
     --migrate` at `migration-needs-op`); on any other node its remedy reads as before.
   - **The op marker's new shape.** While an `--op` pass runs, `~/.ccrc/history/op` holds five fields. A pass from
     the older build still running across the update leaves a three-field marker, read as legacy until it ends. A
     marker written by this build that names a reused pid or another boot no longer holds anything back. A legacy
     marker already on disk keeps the kill probe, so one behind a reused pid of this user still reads live until an
     op pass of this build replaces it; the one change at rollout is a legacy marker naming another user's pid
     (EPERM), which now reads stale. If that marker was hiding a real `tick-stale` or death line, the update's doctor
     shows it (and `ccrc update` may exit 3): that FAIL is real.
   - **Do not roll back across this PR while an `--op` pass runs.** If you must, the older build reads the
     five-field marker as no op, so expect FAIL `tick-stale` (and `ccrc rollback` or `ccrc update` exit 3) until the
     pass ends. Nothing removes the marker meanwhile, because removal runs under the lock the pass holds (D-5748's
     residual (d)).
   - **The relay.** An operator verb's output looks the same; a secret on the line after its key, or a PEM body,
     now prints masked on stdout too. Its cost, measured by Task 3 on 10,000 lines of about 100 B, on one box under
     load: 407 to 426 ms with one windowed, unioned redaction per data chunk (17 chunks) and the composed doors,
     against 93 to 122 ms for the 10,000 lines redacted one line at a time with no window, before; about 2.5 ms a line
     in the worst case, a slow producer whose every read holds one line. A dense secret stream takes 523 to 579 ms,
     and the third review's 1 MiB adversarial stderr (a repeated three-line shape) 0.6 to 0.7 s. The composed doors
     account for roughly half of each figure (226 to 259 ms, 257 to 302 ms and 0.4 to 0.46 s with one reading).
     Held stderr is read one line at a time too, memoised by line: 1 MiB of distinct short lines costs about 3 s of
     CPU on a loaded box (blank or repeated lines about 0.2 to 0.5 s; without the memo, blank lines took 10.5 s),
     against well under 0.2 s for the whole-text flush before, and 1 MiB of coloured lines about 9 s. A Ctrl-C runs
     that flush before its 2 s bound is armed, so on such a stream it is answered after those seconds.
4. **Not ours, named.** The delegation spool's own test calls its bound "512 characters"
   (`delegation-spool.test.ts`), true there only because its padding is single-byte; that file belongs to another
   programme. B3's plan carries a sibling FIFO sentence (Task 9, "a FIFO the probe would block on") the ruling did
   not list; extending the parenthesis there is the coordinator's reading.

### Residuals, named

- **Over-masking of quoted prose** (R1): a quote opened after a context NAME masks the prose up to its closing quote
  (`token: "…"`), so search loses those words. The trade-off is R1's default, taken by the coordinator in the
  operator's place; the operator may change it.
- **The widening lost to composition** (R11, D-5745): the widened rules read only what the older door left, so where
  that door's mark already took a NAME in (a header value glued to it, or a tail head it read as part of a value),
  the value after it is read as before and prints as before. Availability, never a leak: measured on escape-dense
  fuzzed text at 807 of 137,804 planted values through the field door that the widened rules alone would have masked.
- **A value a colour sequence split can print whole** (R11, D-5745): where the widened rules find a value only with
  a text's escape sequences removed (`pass\x1b[0mword=&x`), the door returns the text without them, as the door
  before it already did for its own finds, so a value elsewhere in it that the older door printed split by a sequence
  prints whole, and the index gains it as one term. No value the older door masked comes back.
- **A value printed JSON-escaped can print decoded** (R11, D-5745; the plan's seventh review): where the widened rules
  find a value only at a JSON-decoded level, the index and display doors return that level, as the door before them
  already did for its own finds, so a value the older door printed only escaped (`hunter` + `\u0032xyz`) prints
  decoded (`hunter2xyz`), an index row gains it as one term, and the belt generation rewrites such a row into that
  form. No value the older door masked comes back.
- **Composition's cost** (R11): every door reads its text about twice (measured 1.9 to 2.0 times on this
  repository's code and docs), at capture's index step, in every read door and in the belt walk.
- **The relay's union** (D-5747): where the window's reading writes a piece the per-line reading does not print on a
  line the reading's line breaks allow, the whole piece is a mark, so a line can lose words around a masked value, and
  a piece more than 16 KiB of lines past where it may first lie takes the rest of its batch into marks (availability
  losses). A line only the joined reading masks (a NAME a colour sequence splits) makes every coloured line of its
  batch, and of later batches while it is in the look-behind, a mark: the window's reading removes every sequence and
  the per-line reading keeps them, so no piece of those lines is placed (an availability loss; linear, about 6 to 9 s
  a MiB measured). Where another line of the same batch, read alone, prints the same characters at the same edge,
  they are written beside the mark and that line becomes one: no string this build's per-line reading does not print.
- **A JSON key's next pair, read as one text** (pre-existing): `{"token":` with `"password": "V"}` on the next line,
  read as one text, takes `"password"` as token's value, so V prints through the field door, `redactFinalLines` and
  the index and display doors, as it did before this PR. Each line read alone masks V, and the relay keeps that reading (D-5747).
- **A key at the end of a long line** (D-5747): when a line longer than the relay window ends in a key and a shorter
  line follows it in the same batch, the window drops the key and the next batch's value prints, as the per-line relay
  printed it.
- **Grep's reach on old rows until the generation completes** (R3): a row indexed under version 1 still holds the
  word after a widened value until the generation rewrites it; display already masks it.
- **Shapes longer than the relay window** (R4): a PEM body or a value more than 16 KiB after its key still prints its
  tail; and text already printed before its key line arrived cannot be retracted.
- **A mid-line stderr seam, and the window in memory** (R4, D-5747): a value cut exactly at a mid-line stderr seam (a
  held stretch with no line break past the cap) is read as two lines, as the output shows it; and the window's raw text
  is kept in process memory, as stderr's hold already keeps it.
- **The held stderr's flush cost** (D-5747): read one line at a time and memoised by line, 1 MiB of distinct short
  lines costs about 3 s of CPU, and 1 MiB of coloured lines about 9 s; the signal handler runs that flush before its
  2 s `SIGNAL_FLUSH_MS` bound is armed. An availability loss, never a leak.
- **An unterminated BEGIN line on stdout** (D-5747): a private-key PEM BEGIN line with no END line (a document quoting
  one, say) masks up to the next 16 KiB of that verb's stdout, its error lines included, where the per-line relay
  masked only that line. An availability loss, never a leak, and the same under `--json`, because the window is keyed
  by the shim's stream.
- **The PID-namespace residual** (R5; D-5026's residual (h)): status run in another PID namespace reads a live op pass
  as not live, as `kill(pid, 0)` already did. A legacy three-field marker keeps the reused-pid weakness until the
  next new-build operator pass replaces it.
- **A rollback while an op pass of this build runs** (D-5748's residual (d)): the older build's grammar refuses the
  five-field marker, so its status reports no op and its doctor can FAIL `tick-stale` (exit 3 from `ccrc rollback`
  or `ccrc update`) until the pass ends; nothing removes the marker meanwhile. Roll back only between op passes.
- **The legacy writer arm** (R5; D-5748's residual (e)): a box with no `/proc` (a darwin test box only) writes the
  three-field form, judged by the kill probe, so removing the legacy acceptance later also retires that arm.
- **The budget interaction with wave 5h-1's check** (predicted: argued, not measured): the v2 belt generation spends its
  re-derive slice of each tick before the export step, so on a node that also owes 5h-1's check after a bind, that
  check can stop on `budget` more often until the generation completes: doctor WARNs `export-marks-unchecked`
  (`budget`), which never escalates.
- **The stale-stamp window** (D-5027, R7): a `held_pass_ms` stamped before a store became newer holds `tick-stale`
  back beside `schema-newer` for up to 10 min. Text only, as review 467 ruled.
- **B2's item 6** (R9): strict O(owed), D-5017's ineligible-when-written state and D-5024's pinned-cursor rescan
  stay Later. The one measurement that could ask for them, a read-only query of the live store's leaves cursor, is
  the operator's.

### Rulings (R1–R11)

R1, R2 and R3 were taken by the coordinator in the operator's place; the operator did not rule them. R4 to R11 are
ruled by the coordinator. R11 (2026-10-19) amends R1 and R3, withdraws R10, and accepts R4's line-aligned union.

- **R1** (taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger);
  the operator may change it; questions a and b; amended by R11). The named value class widens in its field form
  only; the final form's named value class is unchanged (D-4613). A quoted value (`"` or `'`) reads to its closing
  quote on the same line, an empty one is no value; an unquoted value ends at whitespace and the backtick, at `&` only
  before `NAME=`, and at `,` `;` `"` `'` only before whitespace, a closer or the end (Task 1): the prototype the scope
  measured. R11 reverts the patches the plan's third and fifth reviews added to it.
- **R2** (taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger);
  the operator may change it; question c). The Bearer and box-token header classes stay as they are (Task 1).
- **R3** (taken by the coordinator in the operator's place, under the operator's directive of 2026-10-19 (ledger);
  the operator may change it; question d; amended by R11). Stored text is re-cleaned as a sweep phase: `BELT_VERSION`
  1 to 2, and the walk rewrites a row exactly when the composed index text differs from its rev 3.6 reading (the stored
  text, on a store a build before this one wrote), beside the rows every belt generation rewrites, and every later
  re-derivation, a pair-owed walk or a roll-forward after a rollback included, rewrites those rows again with the same
  text; no schema change, no new meta key, no new step; `doctor --repair` stays the
  manual alternative (Task 2).
- **R4** (ruled by the coordinator (line-aligned union accepted 2026-10-19); amended on Task 3's measurement and on
  review finding 11). The relay reads each source stream through a 16,384-byte look-behind window, and the stderr
  spill uses the same window. Every piece it writes is text `redactFinalLines` prints reading each line alone (as the
  relay before it read stdout), on a line the window's line breaks allow, and it is never less masked than
  `redactFinalLines` over the same batch, because the standalone pass runs first and the context reading keeps its
  marks (a final standalone pass is measurably insufficient). One batch can hold a PEM block whose mark takes the next
  line's NAME in, which no rule change closes, so the relay unions its reading with the per-line reading over the text
  written; that union also closes review finding 11. Both readings use the composed doors (R11) (Tasks 1 and 3).
- **R5.** The op marker carries D-5016's identity in five fields; a legacy three-field marker is live by the kill
  probe, EPERM not live; an identity-bearing marker is live only when both fields match, with no fallback. On a box
  without `/proc` (darwin test boxes) the marker is written in the legacy three-field form and judged by the kill
  probe; removing legacy acceptance also retires that writer arm (Task 4).
- **R6.** `lag-high`'s remedy names D-5027's three holds only, `schema-newer` first; `at-cap` and the low-disk
  capture pause are not added (Task 5). No D-number.
- **R7.** D-5027's stale-stamp window stays text only; no `heldFresh` guard (Task 6).
- **R8.** This PR lands after wave 5h-1, in separate hunks in `lib.mjs`'s shared regions.
- **R9.** B2's item 6 stays Later.
- **R10** (withdrawn by the coordinator (composition, 2026-10-19)). A JSON-form key rule (a quoted secret NAME that a
  colon follows on its line read as the next pair's key). Under R11 the relay's per-line union closes review finding 11
  for the relay; the rule's code, pins and mutants are removed.
- **R11** (ruled by the coordinator, 2026-10-19). Every redaction door is the widened rules applied over the output of
  the same door as rev 3.6 built it, whose rules are kept frozen and spelled once; every door is subtractive (it
  replaces spans by the mark, decodes JSON escapes or removes escape sequences), so no door prints a value the older
  door masks, one no reading of its output holds. Pinned by a property case through every door, one case that checks
  composition and subtractiveness for every door, and a mutant that reads the widened rules over the raw text
  (Tasks 1, 2 and 3).

### Choices the tasks made

(every task's choice bullets, one line each, its task number first)

### Tests run (foreground, on the worker's box)

(Step 11's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then check the body and every added line. The second command prints a count, never a token:

```bash
grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|\.ts\.net|/home/' .superpowers/sdd/history-w5h2/pr-body.md || echo 'no host or home path'
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; cat .superpowers/sdd/history-w5h2/pr-body.md; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
```

Expected: `no host or home path`, then `0`. A non-zero count is judged by its line, never by printing the token. Re-run the pipeline with `grep -n -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#') | cut -d: -f1` to get line numbers only, read those lines, and rewrite each hit with a neutral stand-in before any push. Without `-w`, a short entry also matches inside ordinary words. The PR body stays under `.superpowers/` (gitignored) and is not committed.

---

## Deviations found

D-5749 and D-5750, issued in this plan's block, stay unassigned: the coordinator withdrew the JSON-form key rule the first was issued for (R10, R11, 2026-10-19), and the second was never used. Neither is defined here.

- **D-5745** — `history-redact-value-class-widened` (Task 1): layer 2's named rule now reads its value whole in the FIELD form, which closes D-5021's residual, and every redaction door reads that rule only over its rev 3.6 door's output (R11). Before, v1's shared class `[^\s"'`,;&]` ended a value at `&`, `;`, `,` and either quote. So `password=abc&def` printed `&def`, and, measured beyond the two recorded examples, so did `password="abc&def"`, `export PASSWORD="s3cr;et"` and `PASSWORD='a b c'`, in every door that runs the field pass. Under ruling R1, the prototype scope b2-redaction measured:
  - a quoted value (`"` or `'`) runs to its closing quote on the same line, and an empty one is no value;
  - an unquoted value still ends at whitespace and the backtick;
  - `&` ends it only before `NAME=`, and `,` `;` `"` `'` end it only before whitespace, a closer (`,` `;` `)` `}` `]`) or the end of the text.

  The field form consumes the closing quote, so `namedSpans` and `tailHead` take the span from the value group's own length. D-4613's structure safety is kept: the final form's class is unchanged byte for byte, and a pin says the final form alone still prints v1's reading. The Bearer and box-token header classes are unchanged (R2), so D-5021's Bearer example stays a pinned residual. A v1 output heals under the new rule (`redactField(v1 output) == redactField(raw)` on a literal table), which Task 2's node rewrite relies on. Display, recall and the `--regex` child redact at read time and heal on deploy; stored text heals in Task 2 (D-5746).

  **Composition (R11, the coordinator's ruling of 2026-10-19, which amends R1 and R3).** Two review rounds (the plan's third and fifth) found three shapes where the widened rules, read over the raw text, printed a value the base masked (a quoted value that takes a NAME and `: ` in, an unclosed quote a closer follows, a `NAME=value` glued to an escaped JSON pair whose key the widened value took in), and each shape's patch left a measured residual in the doors that read twice. Every redaction door is now `v2(base(text))`: `base` is the door as rev 3.6 built it, from `BASE_RULES`, the rev 3.6 rules kept frozen and module-private and built from `contextRules`' one template; `v2` is the same door built from the widened rules, read over `base`'s output (`composeDoor`, `DOOR_READINGS`). The doors are `redactField`, `redactFinal`, `redactFinalLines`, `redactFinalJson`, `redactFinalText`, `redactForIndex`, `redactForDisplay`, `entryIndexText`, `sidecarIndexText`, `redactDisplayWindow` and `displaySnippet`; `nodeIndexTexts`, the `--regex` child, the node fields and the relay read them. Every reading is subtractive (its output is its input, a JSON-escape decoding of it, or its input with escape sequences removed, which is D-4307's joined reading, with spans replaced by the mark; a window carries its note and a snippet's cut may fall inside a mark), so no door prints a value its rev 3.6 door masks, a masked value being one that no reading of that door's output holds (as written, decoded, or with its sequences removed). The patches (v1's named reading unioned into the field pass, an opening quote admitted before a closer, a backslash that a quote follows ending an unquoted value) are withdrawn.
  - **Measured** on a copy of `bd363a76b` with Tasks 1–3, against `bd363a76b`'s own lib, over 60,000 escape-dense fuzzed texts (three seeds; 137,804 planted values): every door's base reading equalled the base's door on every text; no door printed a value the base's door masks; the widened rules read over the raw text printed 7,284 such values through `redactField`, 4,327 through `redactFinalLines`, 10,470 through the index and display doors, 19,253 through `redactDisplayWindow` and 15,853 through `displaySnippet`. Every `v2` reading was subtractive over 3,000 texts in each of two runs. `redactFinal` and `redactFinalText`, whose two rule sets read the same final form, equalled the base's on all 60,000 texts.
  - **Pins.** (j5): the recorded leaks and the reviews' shapes through the field, final-lines, JSON, index and display doors, the final form alone unchanged, the escaped quote and the escaped pair behind 14 glues; (j6) the structural controls; (j7) the heal table, and the field door's base reading equal to v1's literal output; (j8) linearity on 1 MiB inputs, one of them an open quote over `x&` whose tail reaches the widened pattern under composition; (j9) every door `v2(base(…))` and every `v2` reading subtractive, each piece read past any escape sequence it skips (f2Cases, 600 seeded texts and 300 with colour sequences); (j10) no value a base door masks printed in any reading of the output (44,422 such values, 13,042 of them in texts with colour sequences, 0 printed; 3,530 printed by the widened rules over the raw text), with a CONTROL that counts the joined reading's residual (1,941 door readings). (j4) gains an input on which the final pass is still load-bearing after the field door's two passes. Existing pins re-expected for composition: (f)'s and (j4)'s CONTROLs read one field pass, and two cost pins count a composed door's two readings.
  - **Mutants measured red:** the v1 class restored; the lookaheads dropped; the span from the whole match in `namedSpans` and in `tailHead`; the quoted alternatives dropped; a value that starts with the mark skipped; an overlapping alternation (killed by `timeout`); an empty quoted value refused; the final form taking the field reading; the widened reading run on the raw text; `BASE_RULES` built from the widened rules; `redactFinalLines`' readings without their final pass.
  - **Cost:** about two passes of each door, measured 1.9 to 2.0 times the base's `entryIndexText` time over this repository's code and docs in 29,495 4-KiB rows (112 MiB).

  Accepted under R1's default, taken by the coordinator in the operator's place (the operator may change it): a quoted prose value after a secret NAME is masked to its closing quote (`token: "…"`), and search loses those words. Residuals:
  - when a widened value's NAME sits more than `ENTRY_REDACT_MARGIN` before a display window, the window can show part of it (spec §8.3's display residual for a match that is not one token span);
  - a quote closed only on a later line is read unquoted, to its first whitespace;
  - the widening lost to composition: where the base door's mark already took a NAME in (a header value glued to it, `Bearer V&PASSWORD: "W two"`, or a tail head the base read as part of a value, `secret=zqvAPI_KEY= 'zqa zqtail7'`), the widened rules find no head there, and the value after it prints as the base printed it. Over the 60,000 fuzzed texts, the widened rules read over the raw text would have masked 807 values that the composed field door prints, 865 through `redactFinalLines` and 1,986 through the index and display doors. No regression: the base prints each;
  - a JSON key's next pair read as one text (`{"token":` with `"password": "V"}` on the next line): the JSON-form rule takes `"password"` as token's value, so V prints through the field door, `redactFinalLines` and the index and display doors, as at the base (measured at `bd363a76b`). A pre-existing residual, not a regression; each line read alone masks V, and the relay keeps that reading (D-5747);
  - a value a colour sequence split can print whole (the plan's sixth review): where the widened rules find a value only in D-4307's joined reading (`pass\x1b[0mword=&x`), the door returns the text with every escape sequence removed, so a value elsewhere in it that the base printed split (`hun\x1b[0mter2xyz`) prints whole and an index row gains it as one term. The base does the same for its own finds (`tok\x1b[0men=abc`); no value the base masked comes back;
  - a value the base printed only JSON-escaped can print decoded (the plan's seventh review, the same mechanism at a decoded level): the index and display readings return the whole text at the decoded level where their rules find a value, so where the widened rules find one only there (`password` + `\u003d&x hunter` + `\u0032xyz`, JSON unicode escapes), `redactForIndex`, `redactForDisplay` and `entryIndexText` return `password=[redacted] hunter2xyz` where the base returned the text as written, and an index row gains `hunter2xyz` as one term where the base stored `hunter` and `u0032xyz`. The base does the same for its own finds (`password` + `\u003dabc hunter` + `\u0032xyz`); `hunter2xyz` is not a value the base masks, since a decoding of the base's output holds it. Over 60,000 texts with JSON-escaped NAMEs, separators and values (four seeds): 21 to 33 such values per 15,000 texts through those three doors, 8 to 14 through `sidecarIndexText`, 2 to 8 through the window and the snippet, none through the field, final and relay doors. Task 2's generation rewrites such a row into the decoded form (D-5746).
- **D-5746** — `history-belt-v2-value-class-reindex` (Task 2): NEW departure (no spec §16 row).
  - **The gap.** Task 1 widens layer 2's named value class in its field form (D-5745). The read paths (display, the relay, `errLine`, the `--regex` child) heal on deploy, because they redact at read time. Stored text does not: `blobs_fts` (contentless), `nodes.gist`, `nodes.topics`, `node_refs.value` and `nodes_fts` were written under the v1 class, so `password=abc&<tail>` left `<tail>` as an index term and in node fields.
  - **The re-clean is a sweep phase** (R3, taken by the coordinator in the operator's place under the operator's directive of 2026-10-19; the operator may change it). `BELT_VERSION` goes from 1 to 2, so `decideBelt` reads every store as due and the tick's re-derivation opens one belt generation from cursor 0. That reuses the generation, the R-version restart, the rollback witness and the node belt step. There is no schema change, no new meta key and no new step. Grep stays available throughout. `doctor --repair` stays the operator's manual alternative and is not the path.
  - **The walk compares (R3 as R11 amends it).** Under a re-derivation probe (`makeProbeIndex` with `beltAll`), `composeDoor` counts one owed hit when a door's v2 reading changes its base reading's text. The base reading is the rev 3.6 door, which wrote the stored row on a store a BELT_VERSION 1 build wrote, so there the hit is the comparison of the composed text with the stored text, made without the stored text (`blobs_fts` is contentless). The walk rewrites exactly the rows whose composed index text differs from their rev 3.6 reading, plus the pair-owed, layer-4 and glue-window rows every generation rewrites; every later re-derivation, a pair-owed walk or a roll-forward after a rollback included, rewrites those rows again with the text they already hold (Residuals). It replaces the rule-hit this plan first wrote (`valueClassWidened` over each named value, and a count for the withdrawn JSON-form key rule).
  - **Why it is sound, and never un-masks.** A recomputation with no owed pair hit and no belt hit asks the questions the stored row asked and gets its answers (`makeProbeIndex`'s argument), so its base reading is the stored text; with no composition hit, the composed text is that reading. A sidecar's walk text is two composed doors, each counting. A rewritten row's text is its stored text read once more by a subtractive reading, so every value the stored row masked stays masked. It never un-masks; it can add a term: where the widened rules find a value only at a JSON-decoded level, the rewritten text is that level, so a value the stored row held only escaped is indexed decoded, as one term (D-5745's decoded-level residual, the plan's seventh review), as is a value it held split by a colour sequence (D-5745's joined-reading residual). Measured on a copy of `bd363a76b` with Tasks 1–3, against its own lib, over 60,000 escape-dense texts read as entries and as sidecars: every changed index text counted a hit, no hit came without a change, and no rewritten text held a value the stored text masked.
  - **Nodes heal with no code change.** `beltNodesStep` re-redacts each stored field through the composed `redactField` and `redactNodeFields` rewrites it with its `nodes_fts` row. Re-redacting a v1 output gives what redacting the raw text gives (measured by scope b2-redaction on 26 probe inputs; Task 1's (j7)).
  - **Rollback.** A B4 or W5h-1 build reads v 2 as due, walks once and stamps 1. Moving forward reopens the generation, which is safe and costs a second walk.
  - **Measured.** The pure describe (23 cases: seven widened rows, twelve unchanged rows, one of them the widening lost to composition, the escaped-pair rewrite, the comparison over f2Cases through both index doors, the beltAll case and the rollback case) with the frozen-contract case: `11 failed | 13 passed` before this task's lib change, `24 passed` after it; the ingest case `reindexed: 1` and the maint case `1 passed`, each red before. The four mutants were each red: the hit dropped, `BELT_VERSION` left at 1, every composed door counting, and a forced rewrite. On this repository's code and docs in 29,495 4-KiB rows, 204 changed (0.69%).
  - **Cost:** the scope's estimate of about 4–13 min of CPU over about 8–40 ticks on a 2 GB store, with the redaction now read twice (measured 1.9 to 2.0 times): at most about twice that, predicted, not measured on a live store.
  - **Residuals.** While the walk runs, 5h-1's bounded bind check may hold on `budget` (WARN `export-marks-unchecked`, never escalating). Grep can find a tail term in rows not yet rewritten. The bump counts one `redact_belt_generations` event per store. Every later generation finds the rows this build rewrote differing from their base reading again and rewrites them with the same text (an extra rewrite, as a layer-4 hit is).
- **D-5747** — `history-relay-lookbehind-window` (Task 3): amends D-5022's final shape (no spec §16 row).
  - **What D-5022 left.** The operator relay redacted the shim's stdout one line at a time. It held stderr as one text bounded at 1 MiB (`ERR_HOLD_CAP`), and past that it spilled at the last line break. So on stdout a JSON value on the line after its key printed in clear, and so did a PEM body after its BEGIN line (measured at e4936efab). A shape split across the stderr spill was read in two pieces. D-5022 recorded both as residuals, and the coordinator put a per-stream look-behind window on the owed list ("Owed from B2" item 2; scope b2-redaction, B2-2).
  - **The window** (ruling R4).
    - Each SOURCE stream keeps the last `RELAY_LOOKBEHIND_BYTES` of the RAW text it has written. The constant is 16384, declared once in lib and bound in single-definition's VOCABS.
    - The window is cut at the first line start inside those bytes. Only a line longer than the window is kept from mid-line, and only when it is the window's last line: a shorter line after it in the same batch moves the cut to that line's start, so a key at the end of the long line does not reach a value in the next batch (measured at the plan's third review; the per-line relay printed that value too). The cut never falls inside a UTF-8 character.
    - lib `redactAfter(lookBehind, text, idx)` reads each new text with the window and returns `{ emit, keep }`.
    - The windows live in runOpVerb's emit callback, keyed by the stream a text came from, never by where the CLI writes it (under `--json` both go to stderr). Every ending (the close, fail(), the signal handlers) and the stderr spill therefore write through them.
  - **Batches.** opRelay's stdout handler emits each data chunk's complete lines as one batch. The line held before the chunk goes first, and the chunk's last complete line stays held for decideRelay, as before. Measured on 10,000 lines of about 100 B, first before the union and R11's composed doors:
    - 161 ms for the 10,000 lines, redacted one line at a time with no window (the base);
    - 316 ms windowed, in 17 chunks;
    - 30 s windowed one line at a time. That per-line cost, about 3 ms a line, arises only from a producer slower than the relay.
    - Re-measured with the union and the composed doors, on one box under load (the Measured bullet below): 93 to 122 ms for the base's per-line relay, 407 to 426 ms windowed in 17 chunks, and about 2.5 ms a line one line at a time.
  - **The standalone pass runs first: R4, amended by the coordinator on this measurement.** R4 as first written asked for a final standalone pass so that the output is never less masked than redactFinalLines of the batch alone. Run last, it does not give that. R4's purpose holds and its word "final" is withdrawn: the standalone pass runs FIRST and the context reading keeps its marks.
    - Measured at bd363a76b: with `{"token":` in the look-behind and `"password": "V"}` as the batch, the context reading takes "password" as token's value and resumes past it. A pass over its output (`"[redacted]": "V"}`) then sees no secret name left. With the standalone pass first, the batch's value is masked before that reading: `"[redacted]": "[redacted]"}`.
    - What still needs the order, measured with Tasks 1–3: a PEM block the look-behind opens runs to an END line in the batch `TOKEN=<BEGIN line>abc<END line>V`, its mark takes `TOKEN=` in, and the context reading alone writes `[redacted]V`, where the batch alone writes `TOKEN=[redacted]`. A seeded search of 200,000 random pairs found 2 such among 49,572; none with the standalone pass first. Pinned, and M1 is red on it (with the union dropped too, as Step 10's M1 applies it; the standalone pass dropped alone is green, the sub-bullet below).
    - So the batch is redacted alone first, and the context reading runs over that output, where a mark stays a mark.
    - Over 330 measured pairs of look-behind and batch, none came out less masked than the batch read alone.
    - With the union in place, that pin's batch is one line, which the per-line reading masks, so dropping the standalone pass alone no longer reds it, and a search of about 945,000 planted values found no input that separates it; the standalone pass stays, as R4 orders, and is measured red with the union dropped too.
  - **The per-line baseline: R4, amended by the coordinator on review finding 11; its line-aligned union accepted by the coordinator on 2026-10-19.** The base relayed stdout one line at a time, so R4 also measures the relay against that per-line reading: every piece written is text the per-line reading prints, on a line the window's line breaks allow, so a value a line alone masks is written only where another line of the batch prints the same characters. As first written, this task's one-batch-per-chunk relay broke that: one stdout chunk holding `{"token":` and, on the next line, `"password": "V"}` printed V, human and `--json`, where the base masked it (review finding 11). This plan first closed it with a JSON-form key rule, which the coordinator withdrew (R10, R11); the union closes it.
    - **The union (R4's fallback, taken at the plan's second review).** One batch holding `zqx26 <BEGIN line>` and `TOKEN=<BEGIN line>abc<END line>V` prints V, because the first BEGIN line's mark runs to the END and takes `TOKEN=` in, which no rule change closes. So `redactAfter` unions the window's reading (`relayRead`) with the per-line reading (`relayUnion`): it splits the window's reading at its marks and line breaks and writes each piece only when the per-line reading also prints it where it can lie, and a mark otherwise. A union of the text written, not of spans over the original text, because no reading of `redactFinalLines` answers spans; it writes no string this build's per-line reading does not print, and keeps every mark the window's reading wrote. It writes finding 11's next pair as one mark from its key on (`"[redacted]`).
    - **Aligned by line (the plan's third review).** As first written the union looked for each piece anywhere after the last one found (`perLine.indexOf(piece, at)`). It then wrote a value its own line masks where the same characters occur later in the batch, turned every line up to such a later occurrence into marks, and was quadratic (6,966 ms on 1 MiB of a repeated three-line shape). Each piece now has the lines it can lie on, must start or end the per-line line where it starts or ends its own, and is looked for on at most 16 KiB of lines past the first before the last line allowed.
    - **The composed doors (R11).** Both readings are this build's `redactFinalLines`, which reads the widened rules only over the rev 3.6 door's output, so the per-line reading masks every value the base's per-line relay masked, a masked value being one no reading of the output holds; a value the base's relay printed split by a colour sequence can print whole (D-5745's joined-reading residual).
    - **Measured** on a copy of `bd363a76b` with Tasks 1–3: Step 1's property case (47,939 values a line alone masks, with the plan's sixth review's coloured fragments) 0 violations, 1,720 with the union dropped; 200,000 random batches of 2 to 5 lines of 37 fragments, read as one batch and after their first line, none of the 321,747 values the base's per-line relay masks written; the relay's maint neighbours `42 passed`; 10,000 lines of about 100 B in 17 chunks 407 to 426 ms (226 to 259 ms with one reading of each door; 93 to 122 ms for the base's per-line relay), a dense secret stream 523 to 579 ms, 30,000 two-byte lines in one chunk 355 to 375 ms, the 1 MiB repeated shape 0.6 to 0.7 s, 8 MiB in which every third line's value is not where the window's reading puts it under the 30 s ceiling (about 90 s without the reach bound).
    - **The per-line reading is memoised by line (the plan's seventh review).** Read one line at a time, a held stderr's cost grew with its line count: as CPU time over 1 MiB, blank lines 10.5 s against the base's whole-text flush at 20 ms, distinct eight-byte lines 1.6 s against 82 ms. `redactAfter` now reads each distinct line of a batch once (`redactFinalLines` is a function of the line and the index, and the relay's index is never a probe), which changes no output: blank lines 212 to 263 ms, distinct four-byte lines, the costliest plain shape, 2.8 to 3.0 s against 103 to 119 ms, distinct 80-byte lines 342 to 411 ms, at a load average of 60 to 100. Not pinned (a cost ceiling there would be a load flake).
  - **What is written** for a batch is the context reading's part after the look-behind's own redaction, unioned with the per-line reading. Where a span runs from the look-behind into the batch, it is written from the mark that covers the first difference, so a span whose head was already printed has its new tail written as a mark. Lines that fall inside a mark already written (a PEM body after its BEGIN line) are not written again. Text the context reading would write again from the look-behind is not in the per-line reading, so the union writes it as a mark.
  - **Residuals:**
    - a shape longer than the window;
    - text written before its key line, which cannot be taken back;
    - a value cut exactly at a mid-line stderr seam (a stretch with no line break past the cap), which is read as two lines, as the output shows it;
    - the window's raw text in process memory, as stderr's hold already keeps it;
    - on stdout, a BEGIN line with no END masks every later batch until it leaves the window, up to 16 KiB of output (an availability loss, never a leak; the per-line relay masked only the BEGIN line). Pinned in history-lib;
    - a key at the end of a line longer than the window, when a shorter line follows it in its batch (the window bullet above);
    - the union writes a whole piece as a mark where the window's reading writes text the per-line reading does not print on a line its line breaks allow, so a line can lose words beside a masked value, and a piece more than 16 KiB of lines past the first line it may lie on takes the rest of its batch into marks (availability losses, never a leak);
    - where another line of the same batch, read alone, prints a piece's characters at the same edge, the union writes them there, beside the mark, and that line becomes a mark (`see hunter2xyz` after `TOKEN=<BEGIN line>abc<END line>hunter2xyz`): no string this build's per-line reading does not print, pinned in history-lib;
    - a line only the joined reading masks (a NAME a colour sequence splits, the plan's sixth review) makes the window's reading remove every escape sequence of its batch, while the per-line reading keeps them on each line with nothing to mask, so every coloured line of the batch, and of later batches while that line is in the look-behind, is written as a mark, where the base's per-line relay printed it (an availability loss, never a leak). It is the union's costliest shape, every piece unplaced, and linear: 5.9 s for 1 MiB on one line and 9.1 s for 1 MiB of coloured lines at a load average of about 44, so about 45 to 75 s at 8 MiB, past the 30 s ceiling of the 8 MiB pin; history-lib pins its output and 1 MiB of it under that ceiling;
    - the held stderr's flush cost (the plan's seventh review): with the per-line reading memoised, 1 MiB of distinct short lines still costs about 3 s of CPU, and 1 MiB of coloured lines about 9 s, in each spill past the cap, in the close, and in the SIGINT, SIGTERM and SIGHUP handler, which runs `flushErr` synchronously before it arms `setTimeout(raise, SIGNAL_FLUSH_MS)`. So the 2 s bound covers the write's drain, not the redaction, and a Ctrl-C on a verb whose shim held such stderr goes unanswered for those seconds, where the base's whole-text flush took well under 0.2 s per MiB. An availability loss, linear and bounded by the 1 MiB hold, never a leak.
  - **Spec.** §8.4's relay sentence is amended in place.
  - **Pins:**
    - history-lib, 12 cases on redactAfter: JSON and PEM after a key or BEGIN line in the look-behind; a crossing span; the never-less-masked case (a PEM block the look-behind opens); the window at exactly 16384 bytes and one byte further; keep's cut; the unterminated-BEGIN residual, bounded by the window; review finding 11's one-batch input; the union's one-batch PEM input, with its line alignment (characters at the start of a later line, the lines up to a later occurrence, a piece inside a longer word), its residual, an 8 MiB bound under a 30 s ceiling, and the coloured-line residual with 1 MiB of it under the same ceiling; and the per-line property case, with coloured fragments;
    - history-maint, 7 stand-in shim cases: one chunk; the key and the value in separate writes behind a go-file, in both forms; a JSON key just before the stderr spill and its value after it; the per-stream keying; review finding 11's JSON key and next pair in one stdout chunk; and the PEM block that takes the next line's NAME, in one stdout chunk, each human and `--json`;
    - history-cli H-32's source pin, and the VOCABS entry.
  - **Mutants measured red:**
    - the standalone pass dropped, with the union dropped too (alone, the union covers its pin);
    - the union dropped (history-lib's finding-11, PEM and property cases, `1720 of 47939`, and history-maint's finding-11 and PEM cases);
    - the union's line bound dropped, its line-end match loosened, both at once (the union as first written), and its reach bound dropped (about 90 s on the 8 MiB input, re-measured with R11's composed doors), each red on history-lib's union case (the plan's third review);
    - the constant at 16385, and at 16383;
    - no crossing branch;
    - keep not carried, in lib and in the relay;
    - keep not cut at a line start;
    - a long line kept as nothing;
    - a cut inside a character;
    - a window that starts at a line start losing that line;
    - stdout back to per-line redaction;
    - one window for both streams;
    - a second declaration of the constant;
- **D-5748** — `history-op-marker-identity` (Task 4): the op marker `~/.ccrc/history/op` gains D-5016's process identity, changing the grammar in spec §9.6 (`op-running`) and the `history-store-id` tier in spec §9.4 and `shared/lifecycle.ts`.
  - **Grammar.** The marker is `<verb> <pid> <start_ms> <proc_start> <boot_id>`, written by `formatOpMarker` and read by `parseOpMarker`, which now answers `{ verb, pid, startMs, procStart, bootId }`; the start keeps its existing name, `startMs`, and the envelope's `start_ms` is unchanged. A legacy three-field marker parses with `procStart` and `bootId` null. A line is at most 119 B, so the tier gains an `op` bound beside `pass`'s and `pass-died`'s. In the same edit, `pass`'s bound is corrected to 86 B (review 467 F4's erratum, no number).
  - **Liveness.** `decideOpLive(marker, measured)` is the one rule, read by `removeStaleOpMarker` and by status's `op.alive`:
    - an identity-bearing marker is live only when the identity measured now (`sweep.mjs`'s `measureOpProcess`, over D-5016's `procIdentityOf`) equals it in both fields, through `decidePassLive`, with no fallback to the kill probe on a mismatch or an unmeasurable identity;
    - a legacy marker is live only when `kill(pid, 0)` answers ok. EPERM is NOT live, because the fleet runs as one UNIX user.
    - Both `pidAlive` copies (`cli.mjs`, `sweep.mjs`), which read EPERM as alive, and the uncalled `readOpMarker` are deleted.
    - The writer writes five fields, or the legacy three on a box with no `/proc`, and still throws on a failed write (H-101).
  - **Effect.** A marker behind a reused pid no longer reads as a live operator pass, so it no longer holds back D-5026's death line, `stateHeld`'s freshness FAILs, or a false `op-running` WARN. This closes D-5026's residual (i), which had no number.
  - **Rollout.** An `--op` pass of the build before this one, still running across `ccrc update`, leaves a three-field marker, which this build reads as legacy: live by the kill probe, so its hold stands and the update's doctor does not FAIL `tick-stale` on it. Coordinator ruling R5 chose this over refusing the old grammar.
  - **Residuals.**
    - (a) A `status` in another PID namespace than the pass reads a live marker as not live: D-5026's (h), which `kill(pid, 0)` shared.
    - (b) Status reads the marker and then measures, so a pass that ends in between reads as not live; its last tick is then stale anyway. Not measured end to end.
    - (c) A legacy marker keeps the reused-pid weakness until an operator pass of this build replaces it.
    - (d) A rollback to an older build while an op pass of this build runs reads the five-field marker as no op until the pass ends, so `tick-stale` can FAIL meanwhile; nothing removes the marker, because removal runs under the lock the pass holds.
    - (e) Where `procIdentityOf` answers null (no `/proc`, a Darwin test box), this build writes the legacy three-field form, read by the kill probe. R5's row names this writer arm (added by the coordinator on review finding 10): removing legacy acceptance also retires it.
  - **Pins.**
    - `history-lib`: the parse, format and 119 B cases, and `decideOpLive`'s nine-row table plus the null marker.
    - `history-op`: the written marker's five fields and boot id; a reused pid and another boot removed, with an equal identity kept; a legacy EPERM marker removed.
    - `history-cli`: a reused-pid marker gives `op.alive` false and the death line FAILs `tick-stale`; a legacy marker by the kill probe, with pid 1 not live.
    - `ccrc-doctor`: an identity-equal row (WARN `op-running`) and a reused-pid row (FAIL `tick-stale`).
    - `lifecycle`: the tier's 119 B and 86 B, tied to both grammars.
  - **Red mutants** (each measured): the five-field alternative unmatchable; only the boot id compared; EPERM live; a kill-probe fallback on a mismatch; half an identity written; each identity field optional alone; the writer's three fields; the removal's and status's old kill probe; the measurement's EPERM read as ok; the tier back at 87 B; the pass pid and the op verb each one wider. M14, the stale-marker removal made unconditional (Step 13): `history-op` `-t 'D-5748|keeps one naming a live pid'` gives `2 failed | 2 passed` (measured at review 711 and again at its fix round), both through a thrown ENOENT on the op marker (`.ccrc/history/op`), in "a scheduled pass removes a malformed marker and keeps one naming a live pid" and in the D-5748 identity case. That is not the shape Step 13 predicted (the legacy case's assertion, "a live pid's marker is another pass's, and stands"); the count is.
- **D-6068** — `history-belt-forward-restarts-other-version-generation` (Task 2, fix round 1): NEW departure (no spec §16 row). `decideBelt` reads a generation another BELT_VERSION opened as due, so it restarts.
  - **The gap.** A v2 generation completes and stamps `v 2`. After a rollback, a BELT_VERSION 1 build reads v 2 as due and opens its own generation, `{ v: 2, rids: [], gen: [...], gv: 1 }`. If the box rolls forward before that walk completes, `decideBelt` found `genOk` false but, with no live unit at or below the mark, `due` false and so `restart` false. `rederivePlan` then continued the v1 build's walk from its cursor, and on completion `beltAfterGeneration` stamped `v 2` over rows the v1 build wrote below its cursor, or ingested after its generation opened, that no v2 walk had re-cleaned. That contradicted Task 2's own rollback paragraph and Review Focus 2.
  - **The rule.** `due = state.v !== BELT_VERSION || (state.gen !== null && state.gv !== BELT_VERSION) || live.some(...)`. `restart` stays `due && !genOk`, so an open generation recorded under another version is due and restarts at cursor 0. A generation with `gen` null (opened by a B1 build or cleared by a due record) and this version's own generation are unaffected. No other code changes.
  - **Pins and mutant.** `history-lib`, in Task 2's describe: `decideBelt({ v: BELT_VERSION, rids: [], gen: [], gv: 1 }, [], 0)` (and with a live unit) is due and restarts, and `rederivePlan` then walks from cursor 0; a CONTROL pins this version's own open generation as not due and the `gen` null state as unchanged. The case was red on the unfixed code (`live []: expected false to be true`); the mutant that drops the new clause is red the same way.
  - **Cost.** One extra full walk after a rollback-then-forward that was interrupted mid-walk, rewriting only the rows its probe counts, as every generation does.
- **D-6069** — `history-relay-residuals-named-at-review` (Task 3, whole-branch review): NEW departure (no spec §16 row). Two residuals of D-5747's relay, found at the whole-branch review. (a) Cross-stream PRINTS a value in clear: it is inherited from the base relay, not a regression. (b) The misalignment fails closed, and loses availability only. (Review 711 F2 and F3 corrected this entry's first wording, "both lose availability; neither leaks", which was wrong for (a).)
  - **(a) Cross-stream.** Windows are keyed by SOURCE stream (R4), so a key on one shim stream and its value on the other are read apart. Under `--json` both reach the CLI's stderr, so a key on shim stdout with its value on shim stderr prints the value, as at the base: D-5022 never joined them. Review Focus 3 calls this a named residual; D-5747's list did not name it. It is a property of the keying, pinned by Task 3's keyed case in `history-maint` (`the windows are keyed by the shim's stream`) and by mutant M12 (one window for both streams), so it takes no case of its own.
  - **(b) A cross-boundary shape found only in the joined reading.** A NAME that a colour sequence splits across the look-behind boundary is found only by the joined reading. That reading, R, is the look-behind with its sequences removed, and differs from the head inside the look-behind with no mark covering the first difference, so `relayRead`'s line-start fallback writes the look-behind's last line again, with its line break. In `relayUnion` the reading then holds more line breaks than the per-line reading has lines, the line alignment fails, and every piece of the batch becomes a mark. Measured: `redactAfter('file a.md ok\n{"pass\x1b[0mword":', '"hunter2xyz"}\nnext line', makePairIndex([]))` gives three marked lines for a two-line batch. The value is masked. Review 711 measured the cost wider (below) and the trigger wider (below); every case still fails closed (98,584 adversarial look-behind and batch pairs: no piece written outside the per-line reading, and no value printed that the base masked).
  - **Cost.** A whole batch is lost (up to a stdout read's size, with the plain lines of it) and one line more is written. The base's per-line relay printed those lines. When the look-behind holds an escape sequence on an EARLIER line, the joined reading first differs from the head at that sequence, and the line-start fallback then rewrites every look-behind line from there on, up to the window's lines, each as a mark (review 711 measured 6 marks for a 3-line batch: `redactAfter('\x1b[32mgreen\x1b[0m\nfile a.md ok\n{"pass\x1b[0mword":', '"hunter2xyz"}\nnext line\nthird line', makePairIndex([]))`). It still fails closed.
  - **Trigger.** A colour sequence inside a NAME is not the only one: a sequence between a JSON key and its colon (`{"password"\x1b[0m:`) or right after the colon (`{"password":\x1b[0m`) misaligns the same way (3 marks for 2 lines), when the look-behind holds the key and the batch the value.
  - **Pin.** `history-lib`, in Task 3's `redactAfter` describe: the case titled with D-6069 asserts the output holds no value, is exactly three marks, and has three lines for the batch's two; its CONTROL, the same key without the sequence, is aligned and writes `next line`. It passes on the shipped code, because it pins a residual; its expectation, changed to two marks, is red (measured).
- **D-6070** — `history-redact-escaped-quote-residual` (Task 1, whole-branch review): NEW departure (no spec §16 row). A residual of D-5745's widened value class, found at the whole-branch review. A quote that arrives escaped (`\"`, as in JSON-serialised text) is not a quote to R1's quoted arm, so the value is read unquoted to its first whitespace and the words after it still print: `password=\"a b\"` gives `password=[redacted] b\"`. The base printed the whole `"a b\"`, so this is not a regression. Review Focus 1 names the shape; D-5745's residuals named only a quote closed on a later line. Pinned by `history-lib` (j5), whose escaped-quote rows assert that output; the spec's §8.3 layer-2 value bullet names it.
- **D-6071** — `history-display-doors-compose-before-the-cut` (Task 1, review 711 F1): NEW departure (no spec §16 row). The two display doors composed AFTER their cut, so a widened value whose NAME lay in the margin (cut away) printed its tail.
  - **The gap.** `redactDisplayWindow` and `displaySnippet` were `door(impl, shown)`: the base door cut the margin-widened text to the window first, and the widened rules (`shown`) read only the cut. Measured by review 711: `intro text. password="abc defSECRET ghi" after` gives `password="[redacted]" after` through `redactForDisplay`, but `displaySnippet(t, ['ghi'], idx)` gave `...d="[redacted] defSECRET ghi" after`; the panel measured the same for `&`, `;`, `'` and `"` values 4 to 14 characters before `redactDisplayWindow`'s window. Not a leak against rev 3.6 (the base printed the same tails), but it falsified the stated residual (a NAME more than `ENTRY_REDACT_MARGIN` before a window), the plan's R11 and "display margin" text and spec §6.2's "display masks it at read time".
  - **The ruling.** Ruling 7344 (review 711 F1) was option (a) in its literal form: compose before the cut, `cut(v2(base(margin text)))`, made by the coordinator in the operator's place under the build directive. The worker built and measured that form and found it cannot realign: the straightforward form (the widened rules chained into `displayReading` and the margins' `readingAt`) left 99 of 9167 windows inexact in `history-lib` before and 418 of 14422 after, because a margin read alone does not align with the composed reading at an unclosed quote, and the inexact window prints the window alone. As review 721 built it, the literal form is also not subtractive: 102 of 44,422 values that rev 3.6 masked printed. So the worker substituted the token union within option (a), keeping the base's exact cut. The coordinator confirmed the substitution on review 721, in the operator's place under the build directive.
  - **The mechanism.** The base door is byte for byte rev 3.6's (pinned by (j14)). `displayWindowRead` is `displayWindow` and also returns `read`, the base reading of the margin-widened text the cut was made from (null on a whole-text window and a size-inexact one), and, for an exact window, `at`, where its text starts in `read`. The composed door reads the widened rules over `read` (`composedTokens`) and replaces every token of what the cut shows (`UNION_TOKEN_RE`: a mark, or a maximal run of characters that are neither whitespace nor one of `"'`,;&` and hold no mark) that this reading no longer prints with the mark (`maskUnprinted`), then `v2` reads that as before. A token the cut itself split at an edge is decided by the WHOLE token of `read` around that edge (`splitAt`): kept only when that token is printed, a split mark kept as written; an inexact window, which is not a slice of `read`, has no edge leniency. A snippet's cut is `snippetBounds`' (snippetWindow is built on it, byte for byte as before) over the base window text; the composed snippet masks that slice, then trims and adds `...` as snippetWindow does. `composeDoor` takes `{ base, out }` from one read for the display doors, so the base is computed once. It is `relayUnion`'s pattern over tokens: the output only replaces spans of the base output, so it is subtractive over it, and (j10) is unchanged. A window of the whole text through `redactDisplayWindow` is `v2(base)` as before; a whole-text snippet is not (it masks its slice by tokens, as above). **The second reading** (review 721, item 1): the first reading can end a value before a second pair's value and so leave that pair's NAME outside what it prints; `maskUnprinted` then marks the NAME, the last `v2` pass finds no NAME, and the value prints, which the pre-round composition (`v2` over the base door's shown text) masked. A shown token is therefore kept only where BOTH readings print it: the widened reading of `read`, as before, and the pre-round composition's own output (`preRoundTokens`: `redactForDisplayWith` over the base door's shown text, which for a window is its text with the inexact note, and for a snippet the slice `snippetBounds` cuts; an edge fragment is tested as itself, since that reading read the same cut text; a `v2` that changes nothing masks nothing). It widens the reading set only: the cut stays the base's and the output stays subtractive over the base output. `DOOR_READINGS`' display entries gain `whole`, which `composeDoor` returns; `redactDoorReadings` carries it (optional).
  - **Residuals, named.** A NAME more than `ENTRY_REDACT_MARGIN` before the window still prints its tail (pinned as the CONTROL of (j13)); a quoted value whose closing quote lies more than `ENTRY_REDACT_MARGIN` past the window's end reads unquoted in the margin text, so its tail prints (pinned in (j13)); a token that both readings print elsewhere with the same characters still prints (the same characters printed elsewhere in the margin text; at the value level, a value of several tokens prints whole when each of its tokens also prints elsewhere in the same shown window, which per-token membership cannot see, and prints only what rev 3.6 and the whole-text door also print: `password="]SECRETX1Z river stone end; ,token=\"ZQXWORDA ZQXWORDB\" zqxpost ZQXWORDA lamp ZQXWORDB after words`, window [51,131), text only with no pin; this and the window over `DISPLAY_WINDOW_MAX` below are the two residuals that print WITHIN the margin); the whitespace and the six break characters between a value's tokens print, never its words; a window longer than `DISPLAY_WINDOW_MAX` reads no margin; where the widened reading decodes or joins escape sequences the tokens holding them are masked (availability only).
  - **Pins.** `history-lib`: (j11) the review's measured snippet, exactly `...d="[redacted] [redacted] [redacted]" after`, with the base reading's tail as its CONTROL; (j12) `redactDisplayWindow` and `displaySnippet` for a `"`, a `'`, a `;`, a `&` and a colour-sequence NAME, each with the whole-text door and the base reading as CONTROLs; (j13) the residuals (a NAME beyond the margin; a closing quote beyond it); (j15) Cyrillic, CJK and `p@ss.w0rd!+/=` values (scoped review FR1-A); (j16) a cut edge decided by its whole token, at the left edge, the right edge and a snippet, with a filler word's fragment kept as the CONTROL (FR1-C); (j17) a split mark kept as written, at either edge, never `]]`, asserted as the exact left edge (`...redacted] `, then the exact snippet) and the exact right edge (`hit` and 20 `w`, then `password=[redacted]`, for the input `hit wwwwwwwwwwwwwwwwwwww password=xyz;SECRETX tail words here and more`); review 721 F7: the earlier `]]` check could not red for the mark's edge alone) (FR1-E); (j19) a lead drop in the window's reading, 70,000 token characters before a widened value, with the exact window and `wordy` and `SE` absent (review 721 F6); (j18) a value the pre-round composition masked stays masked: the two minimal shapes through both doors, the two corpus texts the fuzz found and the brief's adjacent shapes as the CONTROL (review 721 item 1); (j14) both base readings, 8 literal pairs and a digest over the (j3) corpus and two seeded corpora, captured before the change; (j9) the display doors are subtractive over the base output and a whole-text window is `v2(base)`. (j10) is unchanged.
  - **Mutants (measured).** `composeDoor` returning `v2(base)` for every door (the old composition): `history-lib -t '\(j'` gives `7 failed | 13 passed` ((j11), (j12), (j13), (j15), (j16), (j17), (j19)), re-measured at the scoped review of review 721 (the baseline is 20 passed with (j18) and (j19); it was `6 failed | 12 passed` against 18 before them). The old edge rule (a fragment kept when any printed token ends, or starts, with it): `1 failed | 19 passed` ((j16)), re-measured the same way (it was `1 failed | 17 passed`). The lead-drop offset `ds += n - out.length` deleted: `1 failed | 2 passed` on `-t '\(j1[789]\)'` ((j19): `no piece of the value prints`, the window printing `wordy SE`). `splitAt`'s mark branch returning `null`, and separately `maskUnprinted`'s left mark-edge line removed: `1 failed | 2 passed` each ((j17): the snippet starts `...[redacted] `, not `...redacted] `). `maskUnprinted`'s RIGHT mark-edge line (`if (m1 !== null && m1.mark !== undefined) hi = …`) removed: `1 failed | 2 passed` ((j17): `hit wwwwwwwwwwwwwwwwwwww [redacted]...` for `hit wwwwwwwwwwwwwwwwwwww password=[redacted]`). Dropping the second reading (a token kept when the widened reading prints it, as before commit F): `1 failed | 18 passed` ((j18)), also with it dropped in the window door alone and in the snippet door alone. Round 1's first form (DISPLAY_SPAN_RE's spans) printed non-ASCII words and the punctuation of a value; the fix and the pins are the scoped review's FR1-A.
  - **Measured against the pre-round composition** (review 721 item 1; counts only, never matched text). The pre-round composition is `v2` over the base door's cut, as at `456976411`. A value LEAKS when the pre-round door masks it and the door under test prints it, by the reading (`r11Holds`) (j10) uses. **Before commit F** (the tip of fix round 1): the fuzz, 30,000 calls per door (60,000 planted values per door; the NAME from inside the window to 65,600 characters before it; five NAMEs; `NAME=`, `NAME: ` and JSON-key forms; fifteen value shapes, nine of them adjacent pairs; colour sequences; JSON-escaped once) found 198 values through `redactDisplayWindow` and 233 through `displaySnippet`; corpus 1 (`f2Cases`, `r11Corpus` with seeds `0x5746` to `0x5748` and `r11AnsiCorpus` with seeds `0x1b5746` to `0x1b5748`: 9,035 texts, 20,665 planted values, 9,035 window calls and 18,070 snippet calls) found 1 through each door, window text 1965 and snippet text 830 of `r11Corpus(0x5746, 2000)`, (j10)'s own seed, which cannot see them because (j10) compares with the base door. Every one of them is printed by rev 3.6's base door and by `redactForDisplay` over the whole text, so none is a value either masks. Two shapes produced all of them: a first value that begins with an odd quote and is followed by an escaped quote (192 of 2,960 second values through the window, 206 of 2,980 through the snippet) and an unclosed quote after a coloured NAME, JSON-escaped once (6 of 3,050 and 27 of 3,046). The brief's adjacent shapes, `NAME="a b NAME=value c"` and `NAME=abc;NAME=value`, and the five other adjacent shapes that do not swallow a NAME before a value (seven in all) did not leak: 0 of about 20,900 second values in both doors. **After commit F**: the same corpora, seeds and call counts find 0 per door, in the fuzz and in corpus 1 alike. The opposite direction, values the new door masks that the pre-round composition printed, did not move in the fuzz (4,086 through the window door, 5,912 through the snippet door) and rose by 3 (window), 1 and 1 (snippet) in corpus 1, from 728, 476 and 522 to 731, 477 and 523. Against the previous commit, over corpus 1 (a window of the middle half; a snippet for `hunter2q`) the output differs in 84 of 9,035 windows and 9 of 9,035 snippets, and over the inputs the `history-lib` suite repeats in both runs in 31 of 5,433 windows and 6 of 3,875 snippets (677 windows and 38 snippets are dense inputs whose sizes vary from run to run, and are not compared); `history-recall` in 0 of 26 windows and 0 of 75 snippets (distinct inputs); `history-cli` reaches no display door. The reviewer's base-equivalence and leak fuzz (780c8126c as the base) at reduced counts, 16,600 windows and 16,600 snippets over four seeds, one with the belt: 0 base differences and 0 values printed that the base masked; one window was flagged not subtractive in each of two seeds, and the same window is flagged at the previous commit, so it is the checker's reading of a colour sequence, not this change. (j14)'s digest is unchanged.
  - **Cost.** The display doors read the base once, the widened rules once over the margin text (`read`), and `v2` once over the output: measured at load 18 to 24 by the implementer and the scoped re-review (`cost.mjs`, a 400,000-character body) at about 1.6 to 1.75 times the old composition for windows of 200 and 4,000 characters (25 to 29 ms against 14 to 17 ms) and about 1.75 to 2.2 times for a window of 65,536 (39 to 52 ms against 22 to 27 ms; the base alone is 14 to 19 ms), down from 2.4 to 3.1 times before the base was computed once. The inexact count does not move: the composed door's windows are the base's, because it reuses the base's read (history-lib, pins named D-6071 excluded: 9167 windows, 99 inexact, 0 added, as review 721 counted; the literal form added 5255 windows with 319 inexact (327 as review 721 counted), and the 59 belonged to the form of `95196ade6`, not to this one; history-recall 0 of 256 before, 0 of 512 after). Re-counted at the second reading with a door log over the whole of `history-lib`: 6247 window calls with 58 inexact base reads and 58 inexact outputs, 4028 snippet calls with 1 and 1; `history-recall` 65 window and 191 snippet calls, none inexact; `history-cli` reaches no display door. The second reading (review 721 item 1) adds one `v2` pass over the shown text, which is at most the window's size or the snippet's: `cost.mjs`, 400,000-character body, medians of 3 runs at load 19 to 25, against the previous commit's `lib.mjs`: 28 against 25 ms for a window of 200, 26 against 24 ms for 4,000 and 44 against 38 ms for 65,536 (the old composition: 17, 14 and 21 ms), inside the noise at the two smaller sizes.
