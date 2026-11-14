# W1a context readings: departures found while carrying out the plan

This note is for the programme's coordinator, to fold into `w1a-context-readings.md`'s "Deviations found" and into the
index plan. It names each departure by its plain-words slug, because no number was issued for it on this branch. The
plan file itself is left unedited: the ledger guard refuses an edit to it from a work branch. The departures were first
reported in wave-done mail. Plan review 1927 M1 asked for them here, with the four that review found missing from that
mail.

## Step 1, measured

- **The PreCompact arms run in this order:**
  1. `_hook_compact_pre` (the compaction card);
  2. `_hook_history_pre` (the history steer);
  3. `_hook_compact_pre_line`, this piece's events line, last.

  Each is dispatched on its own line at the bottom of `ccd/session-hook.sh`. PostCompact is `_hook_compact_post`.
- **The lock.**
  - Every section of the row's `.compactions.lock` is taken through `_hook_lock_acquire "$COMPACT_LOCK_WAIT"` and released through `_hook_lock_release`.
  - Under the lock, `_hook_generation_ok` is checked.
  - Each canonical mutation is preceded by `_hook_lock_still_canonical`.
- **Agent reads.** The agent's read whitelist (`agent/src/whitelist.ts`) covers the whole `.cc-sessions/` root, so `$REG/<id>.compactevents` and `$REG/<id>.compacteventsprev` are readable through `FleetIO`.
- **A lock miss writes no line.** The counter then reads one compaction fewer: the miss is a hook that could not lock, not a refusal, and the reader cannot see it.

## Departures

- **sidecar-exact-shape-tests-edited.** The plan said `statusline-script` would stay unedited, but the existing exact-shape cases there pin the sidecar's whole shape. So do those in `usage-sidecar`, `usage-sweep-lane` and `tick-characterization`. Each gains the two `null` fields.
- **precompact-own-file** (ask 367). The pre line goes to its own file, `$REG/<id>.compactevents`, not to the `.compactions` journal. This is legitimately different:
  - every PostCompact commit re-checks the whole journal against `JOURNAL_RECORD_PRED`, a safety boundary;
  - so a second line shape there would refuse every later commit, an older hook's after a rollback included.
- **events-file-named-compactevents** (plan review 1896 B1). The file is never named `precompact`: that is a route field, which `cmd_route --set` writes as `$REG/<id>.precompact`.
- **precompact-bounded-by-rotation.**
  - At `PRECOMPACT_KEEP` (32) lines the file is renamed to `.compacteventsprev` and a fresh file starts, with no temp file.
  - The reader reads the current file before its rotation and takes a repeated line once.
  - A `.compacteventsprev` that is a directory, a symlink or any non-regular file writes no line and moves nothing (review 1927 M5). The rotation can then never fail over and over while the current file grows.
- **precompact-line-own-arm-after-history** (plan review 1890 C1 and I1).
  - `_hook_compact_pre_line` is an arm of its own with its own section of `.compactions.lock`, so none of the card's early returns can drop the line: its off switch, a scope that does not resolve, or its lock miss.
  - It runs last. The compaction piece's coming `_hook_compact_refuse` sets `CS_REFUSED` before it, and this arm will then write `"phase":"refused"`. Nothing refuses a PreCompact today (review 1927 M3).
- **compaction-scope-main-only** (plan review 1896 B2). Every line carries the hook's scope verdict, which the arm asks for itself when the card did not run. `compactionsSince` counts only lines whose scope is `main`.
- **pre-line-carries-the-scope-rule-not-the-overlap** (review 1927 I1).
  - The line carries `_hook_compact_scope`'s own answer, never the card's overlap degrade: `main`, `subagent`, or `ambiguous` when the rule itself cannot decide.
  - The degrade is the card's question: which context does an unconsumed set serve? `_hook_compact_pre` keeps the rule's answer in `CS_RULE_SCOPE` and `CS_RULE_TRANSCRIPT` before writing `ambiguous` over `CS_SCOPE`.
  - Why it matters: a PreCompact with no PostCompact (W0-05) leaves its set unconsumed for twenty minutes, and a second main compaction inside them is still counted.
- **refused-never-cancels** (plan review 1896 B3). A `refused` line is read and never counted, and it never cancels a `pre`.
- **null-scope-kept-apart-from-ambiguous.**
  - A line whose scope did not resolve carries `scope: null`, and the reader keeps that `null` apart from `ambiguous`; a word outside the three also reads `null`.
  - Neither counts. The two stay distinct so a later reader can tell "no verdict" from "the rule could not decide".
- **compaction-line-carries-transcript.**
  - `CompactionLine` has `transcript` and `scope`, beyond the plan's interface.
  - A post pairs with a pre only when their transcripts do not contradict: equal, or one side unnamed.
- **compactions-max-matching.** Posts pair to pres by maximum matching (augmenting paths). The count is pres + posts − matching, so appending a line never lowers it.
- **compactions-read-as-one-union** (review 1927 M1).
  - `readCompactionsMeasured` answers one union, not one `FileRead` per file:
    - `unreadable` when any file could not be read;
    - `absent` when none of the three exists;
    - otherwise `lines`, with `skipped` and `eventsAbsent`.
  - The callers' rule is that any unreadable file is unmeasured and an absent one has no lines, and the union keeps every distinction that rule reads.
  - `eventsAbsent` keeps one distinction the fold would otherwise narrow: a journal with neither events file is an older hook's, whose count is only a lower bound.
- **count-in-place-of-num** (usage reader).
  - `ctxTokens` and `ctxWindow` are read through `count`, not `num`: a finite number above zero, else `null`.
  - A negative is no reading. So is a zero: Claude Code sends `total_input_tokens` 0 before a conversation's first API response, and a zero window would make a ratio NaN or Infinity (review 1927 I2).
- **revive-carries-the-context-fields** (review 1927 M2). `reviveUsage` carries `ctxTokens` and `ctxWindow` with `optNum`, as it carries `cacheExpiresAt`. So a state-cache load and the PWA's offline snapshot keep them, and "one reader per field" holds for the persisted shape too.
- **purge-inventory-names-compactevents.**
  - `_reg_purge`'s inventory comment in `ccd/ccd` names both files, edited in place with consent from run 1878.
  - Both files are dot-free, so `_reg_purge`, `_ws_slug_free` and `_ws_slug_residue` take them by their suffix shape.
- **hook-sixth-acquire-site.** The arm is the hook's sixth acquire site.
  - **The numerals** move from five to six in the hook's prose, the compaction-card spec and `session-hook.test.ts`.
  - **The jq-program census** gains the arm.
  - **The AMBIGUOUS fork window** now closes at the arm's `flock`.
  - **The ITEM 3 list:** its `MUTATIONS` gains the arm's rotation and its append (review 1927 I3). Each guard's removal is measured red.
- **events-arm-defined-mid-hook.** The arm is defined just before the R5 search gate, which places it between two constraints:
  - below the W3 anchor, as `session-hook-steer` requires;
  - above main's hook line 5210, whose `"<<_"` inside a jq string `growth-check` reads as an unclosed heredoc (filed as #2745).

  `session-hook-steer`'s fork CONTROL compares hooks without the arm's call line, and it now also asserts the unarmed equality on them (review 1927 M4).
- **census-rows-for-the-arm.**
  - `ccd-id-cap` has a row for `<id>.compacteventsprev`, whose field is 17 characters, past `FIELD_MAX`.
  - `ccd-workspaces`' disposition list names the new slug-residue case.
- **test-file-named-precompact.** The hook's suite is `server/test/session-hook-precompact.test.ts`, not the plan's `session-hook-compact-events.test.ts`. It was named before plan review 1896 B1 renamed the file it tests.

## Carried to the generations piece, not this branch

- **M7.** `COMPACTION_PAIR_MS` (ten minutes) has no measurement behind it. A compaction slower than that counts two, which errs toward an early renewal. It wants a W0 figure.
- **N1.** Non-main lines share the 32-line rotation window.
- **N2.** The journal is unbounded and read whole on every call. The generations lane should read it on change.
