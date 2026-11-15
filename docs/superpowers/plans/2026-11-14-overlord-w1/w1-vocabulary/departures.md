# W1 vocabulary: what the build found

The build of [the W1 vocabulary plan](../w1-vocabulary.md), Tasks 1 to 4, in one pull request. These are the places where
the build departs from the plan's text, or measured something the plan expected otherwise. Each has a plain-words slug;
the coordinator mints the numbers and folds them into the ledger.

## Departures

| Slug | What the plan said | What the build did, and why |
|---|---|---|
| `account-sign-in-helper-types-nothing` | The census finds sends in `ccd/ccd-account-auth` on its first run and maps each to `operator-secret` (question 3). | Measured: the file is bash (an `env bash` shebang), the census reads it, and it holds one `send-keys`, in a comment. It types nothing through `send-keys`, so `CCD_SPLICED_SITES` has no `operator-secret` entry. A send added there later is a splice in an unmapped function, and reds. |
| `none-splice-pinned-by-digest` | A `none` splice is "pinned as written". | It is pinned by the first 16 hex digits of the SHA-256 of the whole send as written, its flags included (`cmd_clip`'s `send-keys -t "$(_tmux_t "$id")" -l "$dest "`), so a dropped `-l` changes the digest (review 2125, F5). The census never has to spell an argument, in its source or in a failure message, which matters most for a send whose text is a secret. |
| `three-tests-pin-the-old-text` | The plan's file list. | Three tests outside it needed a line or two each (a fourth, `collect-lane-l0.test.ts`, is the row above). `mail-routes.test.ts`'s kebab-token scan of `server/src/coord` met `mail-nudge` (the row key `renderMailNudge` reads) and `stall-arm` (the kind `practiceCases.ts` now keeps); both join its `NOT_CODES` with a reason. `lane-draft-never-blocks.test.ts`'s control rewrote the literal `'/clear', { onDraft: 'stash' })`; it now rewrites the reference. `single-definition/ask-digest.test.ts` pinned the idle nudge's sentence to one code line in `shared/api.ts`; it now names `shared/injected-prompts.mjs`, scanning `ALL` and `ALL_MJS` together. |
| `capability-missing-flip-lands-first` | Task 3 changes the `continuity-timers-vocab` assertion in the group's commit. | Ruled in the brief: the flip is a commit of its own. It is the first of Task 3's two commits: the group with `capability-missing` alone (501) and the flipped assertion; the second adds the other seventeen words and the Table 11.6 guard. The tip is green (the pull request lands as one squashed commit). |
| `cases-written-once-in-the-set-file` | The census's "Rows" cases and `practice-triggers.test.ts`' cases, and two mutant sets over them. | Each reader's cases are written once in `server/test/sim/vocabularySets.ts`, as suite cases over a module (`timerSets.ts`' idiom). The census and `practice-triggers.test.ts` run them against the real modules, and `mutation-floors.test.ts` against each mutant. |
| `mutate-loads-the-mjs` | If `mutate.ts` cannot load an `.mjs` subject, run the set against a `.ts` shim. | It loads the `.mjs` copy directly. No shim. |
| `refusal-status-spread-is-checked` | F18: no other group holds a word of the group. | Also checked: `REFUSAL_STATUS` takes each Overlord word from the group's spread alone, with no literal key and no other spread naming one, because a later spread of the same key would override its status silently. |
| `task-1-bite-check-by-hand` | Task 1's bite check runs through the coordinator skill's `mutation-run.py`. | That helper loads Python modules only. Each mutant was applied to a saved copy of the file, the characterization run, and the file restored from the copy: all three red. |
| `api-reexport-is-import-then-export` | `shared/api.ts` keeps `export { IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX } from './injected-prompts.mjs';`, about −2 code lines (question 2). | `collect-lane-l0.test.ts` holds `shared/api.ts`'s import lines to an enumerated list and refuses any `export … from`, which the fast run measured red. So `shared/api.ts` imports the two constants and re-exports them with a bare `export { … }`, and that list, and `peers-claims-l0.test.ts`' count of the same lines (now nineteen, three of them values from import-free L0 siblings), gain the one import line, as `hookEventIs`' did. No importer changes; `shared/api.ts` is −1 code line. |
| `census-reads-tmux-verbs` | The census reads `send-keys`' arguments. | Review 2125 (F2, F4, F5, F6), as ruled: after `_tmx`, `tmux` or a forwarder named in `CCD_TMUX_FORWARDERS` (`_pane_scope_tmux`, whose own `"$@"` is its callers' verb), tmux's `send` alias and every other `send-…` prefix are findings, and so is a verb that is no literal where a command starts (a message's prose is no call); `paste-buffer`, `load-buffer` and `set-buffer`, and their aliases, are refused anywhere in ccd. Each `printf` in `_resume_prompt_for` prints a text that starts with `$RESUME_PROMPT` or `$head`. A `head` splice's literal is the row's text followed by a space, or the row's text followed by a `${x:+ …}` that begins with one. A `sendPrompt` reference must be imported from the list's module or a module that re-exports the name, and an element access by a typer's name is a finding. One planted control each, and the two the review found missing (a server row no site types, an operator site above its count); each was measured red with its guard disabled. |
| `reader-trims-one-newline` | `injectedPromptOf` reads its input "trimmed of a trailing newline". | As specified, and now said in its doc comment: it trims exactly one trailing `\n`, unlike `server/src/transcript/parse.ts#eventsOfRecord`'s `.trim()`, and an empty argument list joins as the name alone. Cases pin how `'/clear '`, a `\r\n` and a double newline read today (review 2125, F3). History's door, its first caller, is told by the coordinator. |
| `prompt-constants-typed-as-string` | `.d.mts` declares the two moved constants. | It declares them `string`, not their literal types, so each sentence is spelled once, in the `.mjs`. |

## Measurements

- **Typers found.** Server: four `sendPrompt` callers (`watch.ts` twice, `server.ts`'s prompt route, `clearSender`),
  two `sendLiteral` callers (inside `sendPrompt` and `answerDialogText`), one `answerDialogText` caller, the literal keys
  `Enter`, `M-Enter`, `C-u`, `C-s`, `Tab`, `Up` and `Escape`, and four computed-key sites. ccd: five typing functions,
  eight `-l` sends (five literal, three spliced), and the keys `Enter`, `Escape`, `Left`, `Right`, `Up` and `Down`.
- **Task 1's bite check.** A changed character in the mail nudge's head, `'/clear '` in `clearSender` and a dropped
  `ultracode` literal in `ccd/ccd` each red the characterization.
- **Floors.** `shared/injected-prompts.mjs#injectedPromptOf`: 5 of 5 mutants killed, floor 1.
  `shared/practice-triggers.ts#parseSignature`: 4 of 4 killed, floor 1.

## Residuals the census leaves

Named by review 2125 (F7) and ruled to need nothing:

- `CCD_NON_PROMPT_LITERALS` is keyed by value only, so its `s` (a picker's select key) passes from any ccd function.
- The computed `sendKey` keys are pinned by their site and argument text (`COMPUTED_KEY_SITES`), not by the values they
  can take; each site's derivation is a note, not a check.
- `refusal-table.test.ts`'s `REFUSAL_STATUS` spread check reads string and identifier keys, not computed ones; a
  computed key with a different status is still caught by the runtime check of each word's status.

The plan's "Index changes" bullet (a later piece adds a missing word "to the exception list") is wrong against the
shrink-only guard (review 2125, F1). As ruled, a later piece adds the word's row to Table 11.6 in the same pull request;
this pull request leaves the plan file as merged, and the coordinator carries the wording.
