# Follow-up: the no-key guard follows calls

Programme `model-class-advance`, epic `anthropic-arm`, ticket `no-keys-transitive`. Run 3341. It closes finding F1 of
wave 8's third review: the source guard that keeps keys away from Claude Code's rate-limit menu, and keeps the passive
model-class observation typing nothing, saw a key sender only when a guarded body named one itself.

## What was there before (measured on `main` at bf2c218053)

The guard cut each guarded function's body out of `ccd/ccd` (and every function of `ccd/lib/model-aliases.sh`) and
refused a raw tmux key sender or a call to one of four typing helpers (`_route_type_model`, `_route_type_effort`,
`_route_escape`, `_answer_two_option_dialog`). A function that typed by calling a caller of those helpers stayed green:
`_route_apply_now "$1" || :` added to `_alias_model_observe` left the file 35/35.

## What changed (test only; no shipped file is touched)

- **A call graph of ccd's own shell sources**, read once: `ccd/ccd` and every `ccd/lib/*.sh`, the libraries listed from
  the directory so a new one is covered at once. Every function is cut out at its column-0 header; an edge is a
  whole-word mention of a defined function's name in a body's code lines (comments stripped, strings kept, so
  `bash -c "source … && fn"` counts). About 1,020 functions; 10 hold a raw key sender and 39 reach one.
- **A key sender is derived, never listed:** any function whose code holds a raw tmux key sender, closed over its
  callers. A row pins that the four typing helpers are raw senders and that `_route_apply_now` is derived as one.
- **The protected set:** the eleven limit-rescue functions, `_dispatch_swap`, and every function of the model-aliases
  library (both observe functions among them). Each must reach no key sender; a failure names the path.
- **Two cut edges**, by the coordinator's ruling (call 299, mail 31141), each pinned to still be an edge and to still meet
  its reason in the source:
  - `_watchdog_resume_run -> cmd_ensure`: it types only into the fresh session's startup dialogs, after the old session is
    killed, and stands down on a limit banner. Pinned: `kill-session` comes before `cmd_ensure` in its body.
  - `_operator_choice_promote -> cmd_route`: it calls `cmd_route` without `--apply`, so nothing is typed. Pinned: no
    `--apply` in its body.
- **The first cut's stand-down is pinned too:** in `_accept_first_run_prompts`, `if _pane_hard_blocked "$pane"; then` is
  followed at once by `return 5`, nothing after it sends a key or calls a sender, and `_pane_hard_blocked` still reads a
  limit banner (`limit reached`, `rate limit`).
- Every existing assertion stays, and the direct pattern is now built from the same raw sender pattern the graph uses.

## What the transitive guard found in today's tree (reported before any change, mail 31130)

1. `cmd_limit_watchdog -> _watchdog_one -> _watchdog_resume_here -> (transient unit) _watchdog_resume_run -> cmd_ensure
   -> _spawn_settle -> _accept_first_run_prompts`: real at run time, but the keys reach a NEW session's startup dialogs
   after the menu's session is killed. Cut 1.
2. `_watchdog_resume_run -> _operator_choice_keep -> _operator_choice_promote -> cmd_route -> _route_apply_now`: static
   only; `cmd_route` returns before `_route_apply_now` without `--apply`. Cut 2.

## Text fix for the next substantive change to `ccd/ccd` (not made here, by ruling)

The ruling named `_watchdog_resume_here`; the words are on `_watchdog_resume_run`'s header line, exactly:

    _watchdog_resume_run() {   # id — the transient unit's body: the stop-and-ensure a swap does, on the SAME account. Types nothing.

"Types nothing" is true of its own body only: through `cmd_ensure` it answers the fresh session's startup dialogs.
Suggested wording: "Types nothing into the old session; the fresh one's startup dialogs are answered by
`_accept_first_run_prompts`, which stands down on a limit banner."

## Mutation rows (a `git archive` copy of the tip, one edit at a time, each run alone, then restored)

Baseline 69/69. Every row red; the copy restored to 69/69 and byte-identical to the tip.

| Row | Edit | Result |
|---|---|---|
| D1–D4 | each typing helper called directly in `_alias_model_observe` | red, 3 failed each |
| T1 | `_route_apply_now` called in `_alias_model_observe` | red, 2 failed |
| T2 | a two-level wrapper around `_route_type_model` (defined in `ccd/ccd`) called from `_alias_observe` | red, 1 failed |
| T3 | `_route_escape` through one wrapper, called from `_watchdog_one` | red, 2 failed |
| R1 | a typing helper called directly in `_watchdog_resume_here` | red, 4 failed |
| R2 | `cmd_ensure` called directly in `_watchdog_resume_here` (a path outside the cut edge) | red, 3 failed |
| R3 | the limit-banner stand-down removed | red, 1 failed |
| R4 | a key sent before the stand-down returns | red, 1 failed |
| R5 | a key sent after the stand-down, later in the loop | red, 1 failed |
| R6 | the hard-block reader no longer names a limit banner | red, 1 failed |
| C0 | both cuts removed | red, 4 failed (the four watchdog functions) |
| C1 | the promote call given `--apply` | red, 1 failed |
| C2 | the resume no longer kills the old session before it ensures | red, 1 failed |

## Run time (the one file, three runs each before and after, `--maxWorkers=2`)

- Before: 35 tests; file 14–16 ms; whole run 0.55–1.16 s, mostly import and transform.
- After: 69 tests; file 17–18 ms; whole run 0.53–0.89 s. Building the graph at collection takes 100–310 ms
  (five runs, load-dependent): one read of each source and one pass over its lines, no process started.

## Limits

- The graph reads names, not flags or conditions: an edge exists wherever a body names a function. That over-approximates,
  which is why the two cuts exist; a function reached only through a name assembled at run time (`cmd_$verb`) is not
  seen.
- `ccd-typing-check.test.ts` cuts functions with its own parser. Sharing one cutter through `ccdWsHelpers.ts` would be a
  consolidation for a later change; this ticket edits only its own file.
