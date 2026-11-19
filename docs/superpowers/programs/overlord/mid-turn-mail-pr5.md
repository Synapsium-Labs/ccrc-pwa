# Overlord wave 175, mid-turn mail PR 5: notes for the ledger

This note records what PR 5 of the mid-turn mail plan (`docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, Tasks 5.1
to 5.4 and Task 3.3's hook arm) built and measured, and the departures found, by slug. The coordinator folds it into the
programme ledger and mints any numbers. No D-number is defined here.

## In short

- **Built:** `ccd/lib/mail-hold.jq`, the matcher, the fixed texts, the sender map and the shadow log's decision; the
  hook's builtin read of the `mailhold` marker and its one function, `_hook_mail_hold`, called once after the last deny
  arm; the shadow log with its seen file, rotation and `Stop` line; the module in the install, backup and uninstall
  lists; the hook as the third reader in `mailhold-parity.test.ts`; and the rig carries from PR 0's review.
- **Everything ships shadow.** Nothing in the tree writes `mailhold-notice-live` or `mailhold-refuse-live`, and a
  single-definition scan holds that. PR 4, the projection that writes the marker, is not on `main` yet, so every case
  here runs against fixture markers.
- **Growth,** by the growth check's own counter against the merge base `c5b4d587c`: `ccd/session-hook.sh` +34 at the
  first tip and +35 after fix round 1 (F7's builtin command read; the plan estimated +36), `ccd/ccrc` +2, `deploy/deploy.sh` +2. `growth-check` passes armed, with no waiver.
- **Every guard of the plan's Table 6 has a mutant,** an in-place edit restored from a saved copy whose sha256 was
  checked after each restore (ruling N1): 63 mutants at the first tip, 61 red, and 2 equivalent mutants that cannot red
  (section 2). After fix round 1, 96 mutants: 95 red and 1 equivalent (section 6).
- **The rig case asserts E's line natively,** on 2.1.312, 2.1.327 and 2.1.328, and on each of the three builds it
  reds with ccrc's PreToolUse hook deleted and with its matcher narrowed to `Read` (section 4).
- **Fix round 1 (review 2788)** ties a sync's target to its verb's own command, reads quoted targets through
  `mh_prep`, keeps over-cap segments whole across `"…"` and `$(…)`, narrows option arguments to closed lists, adds the
  ruled forms that name main, and moves the strip's pre-filter onto the command (section 6).

## 1. What runs where

| Piece | Where | What it does |
|---|---|---|
| The marker read | `ccd/session-hook.sh#_hook_mail_hold` | `[[ -f ]]`, a symlink refused, `mail-disabled` dark; `IFS= read -r -d '' -n 256` (the bytes as ccd wrote them); `MAILHOLD_RE_BODY` copied; the inline clock; `10#` on `until`; `live`, `lapsed` or `far` |
| The strip | the same function | the module's `mh_prep`, then MERGE_STRIP_JQ unchanged, in one jq call with the merge deny's arguments, only on a Bash call whose command holds `push`, `commit`, `merge`, `pull` or `rebase` (read with builtins, F7) |
| The matcher, texts and log decision | `ccd/lib/mail-hold.jq` (`mail_hold`) | returns the outcome, the text, the log lines and the new seen text; never an envelope (P15) |
| The envelope | `_hook_deny_json`, `_hook_nudge_json` | unchanged, so the envelope keeps one owner |
| The call | after the fan-out routing deny | only on `PreToolUse` or `Stop`, and only while no deny is built |

*Table 1. PR 5's pieces.*

## 2. Mutations (Task 5.3)

Each row is one mutant; "red" names the case that went red. A row that names a list ran one mutant per member.

| Guard | Mutant | Result |
|---|---|---|
| Head separators `&&`, lone `&`, `;`, `\|\|`, `\|`, `(`, newline | each dropped (`&` as `&&` only) | each red: its separator case |
| Head separator `$(` | dropped | **survives** (`dollar-paren-subsumed`) |
| Git option skip by shape | dropped; then a closed list of `-C`, `-c`, `--git-dir`, `--work-tree`, `--no-pager` | red: all 8 option cases; then `-P`, `--bare`, `--config-env` |
| Wrappers `time`, `env`, `command`, `exec`, `nohup`, `sudo`, `timeout <n>` and prefixes `VAR=value`, `VAR=$(…)`, a path | each dropped | each red: its case |
| Reserved words `!`, `{`, `if`, `then`, `do`, `else`, `elif`, `while`, `until` | each dropped | each red: its case |
| Acts: `git push`, `git commit`, the merge, pull and rebase of main, `gh pr merge`, `ccd pr-admin-merge` | each dropped | each red: its act's cases |
| Sync targets `main`, `origin/main`, `origin/HEAD`, `origin HEAD` | each dropped | each red: the each-target case |
| Sync target `origin main` | dropped | **survives** (`origin-main-subsumed`) |
| Targets read on the raw text | read on the stripped text only | red: both quoted-target cases |
| Fail closed on an unterminated quote | the leftover-quote test removed | red: the unterminated-quote case |
| The over-cap kinds | no kinds over the cap | red: the over-cap `git push` case |
| Lease lower bound `now < until` | dropped | red: the expired case |
| Lease upper bound `until <= now + 360` | dropped; then `<` | red: the far case; then the exact-edge case |
| The subagent text | the main-thread text for every thread | red: the joined subagent's `git push` |
| No E line in a joined subagent | the `tmsub` test dropped from E | red: the subagent's ungated call |
| The join test, not the bare `agent_id` | `paid` for `tmsub` | red: the unjoined `agent_id` case |
| The sender map | `overlord` renders "its coordinator" | red: the map case |
| The missing module | the file test dropped | red: the missing-module case |
| `mail-disabled` dark | the file test dropped | red: the `mail-disabled` case |
| E's arming marker | A's marker tested for E | red: the E-only case |
| A's arming marker | E's marker tested for A | red: the E-only case's `would` |
| "No deny built yet" | the call site's guard dropped | red: both earlier-deny cases |
| The seen file | every call logged | red: the 300-call case |
| The outcome in the seen key | dropped from the key | red: both outcome-in-the-key cases |
| The rotation | never rotate | red: the 1 MiB case |
| MERGE_STRIP_JQ untouched | one byte changed | red: the sha256 case |
| The hook's read keeps the bytes (beyond Table 6) | a default `read` that trims | red: the parity run, hook beside owner |
| No writer of the arming markers (beyond Table 6) | a `: >` of the E marker on the hook's line | red: the single-definition scan |
| The module's `gh` flags between `pr` and `merge` (beyond Table 6) | dropped | red: the parity with GH_MERGE_RE on the merge deny's corpus |

*Table 2. 63 mutants. The rig's two mutants are in section 4.*

## 3. Cost (Task 5.4)

Measured in a fixture HOME on the fleet box, 200 `PreToolUse` calls of each kind through the real hook, each call one
`bash` process timed whole, both arming markers standing, at a load average of about 7 to 8. No assertion is written on
the numbers.

| Kind | p50 ms | p95 ms | jq calls | jq calls with no marker |
|---|---|---|---|---|
| No marker, a Read | 18.5 | 25.1 | 6 | 6 (main's hook: 6) |
| A live marker, a Read | 24.5 | 37.3 | 8 | 6 |
| A live marker, a gated Bash call | 28.0 | 35.5 | 7 | 4 |
| A live marker, a gated Bash call with a merge word | 32.8 | 41.7 | 10 | 7 |

*Table 3. The hook's cost. The jq calls are a warm call's, counted by a wrapper on PATH.*

- **A call with no marker makes no new jq call:** 6 on `main`'s hook and on PR 5's, the count the hook test pins.
- **A live marker on a Read adds two jq calls** (the module and the envelope, P15), about 6 ms at the median.
- **A gated Bash call adds three** (the strip, the module and the envelope), and **three again beside the merge deny's
  own strip** when the payload holds a merge word, so the strip runs twice there, as P6 says.
- **The timings are noisy.** Two later runs at a load average of 12 to 13 moved the medians by up to 70 ms in both
  directions, on `main`'s hook and on PR 5's alike. Only the first, quieter run is in the table.

## 4. The rig carries from PR 0's review

- **A `systemLine` matcher in `mockapi.mjs`:** a regular expression over each `role: "system"` message after the last
  user message (so after the newest tool result), whose content is a string or text blocks, read from its start. It
  meets the reader contract (a) to (e) in `mid-turn-mail-e-rig.md`; a scenario's expression keys on the
  `PreToolUse:<tool> hook additional context: ` prefix. Since fix round 1 (F10) the scenario's expressions end at E's
  fixed text, followed by the end or by 2.1.312's measured trailer (`\n\n<total_tokens>N tokens left</total_tokens>`)
  and the end, so appended text fails; `delegation-rig.test.ts` reads them from the scenario and holds both sides.
  `delegation-rig.test.ts` holds it: a string, text blocks with a trailer, no line, another system message, a line
  before the newest result only, and the text inside the tool result.
- **`scenarios-overlord/ov-pretool-notice.json`,** an asserting case: each of its last three labels is served only when
  E's line, whole from its start, follows the tool result before it. A `SessionStart` stub, `stubs/mailhold-plant.sh`,
  plants the module and a live marker in the fixture HOME (`rig-module-planted-by-stub`), and the scenario's
  `launch.files` arms E.

| Run | Labels | Notes |
|---|---|---|
| 2.1.328, as committed | t1, t2, t3, t-done | none |
| 2.1.327, as committed | t1, t2, t3, t-done | none |
| 2.1.312, as committed (its trailer present) | t1, t2, t3, t-done | none |
| 2.1.328, ccrc's PreToolUse hook deleted (installer edited in place, restored, sha256 checked) | t1 | `waitLabels`: timeout |
| 2.1.328, its matcher narrowed to `Read` | t1 | `waitLabels`: timeout |
| Fix round 1: 2.1.328, 2.1.327 and 2.1.312, as committed (the tightened regexes) | t1, t2, t3, t-done | none; verdict exit 0 |
| Fix round 1: 2.1.328, 2.1.327 and 2.1.312, each with the hook deleted, then the matcher narrowed | t1 | `waitLabels`: timeout; verdict exit 1 |

*Table 4. The rig case. `rig.sh run` exits 0 on a red case too (a `waitLabels` timeout only writes a `notes` line,
which `build-matrix.mjs` reads as `unmeasured`), so the verdict is this one command, non-zero on a red or unmeasured
run: `ccrc test --local -- bash server/test/delegation-rig/rig.sh run <build>
server/test/delegation-rig/scenarios-overlord/ov-pretool-notice.json <out-dir> && [ ! -s <out-dir>/notes ]`, then
`rig.sh reap`. Nothing from a run is committed, and nothing automated runs the scenario.*

## 5. Departures, by slug

| Slug | Finding | Where |
|---|---|---|
| `growth-counter-false-heredoc` | The growth check's bash counter (`measureBash`) reads the jq string `"<<_"` in the child deny arm as a heredoc opener that never closes, so every line after it, comments included, counts as growth. Inline, the block measured +60. As one function defined before that line (beside the precompact read, where Task 5.2 places the marker read) and one call after the last deny arm, it measures +34. The defect stands for every later edit below that line, door A2's and approvals PR 2's included. | `server/test/growthCheck.ts#measureBash`, `ccd/session-hook.sh` (the child deny arm) |
| `mailhold-block-as-function` | The plan's "one block after the last deny arm" is built as `_hook_mail_hold` plus one call there. The order is the plan's: a deny already built wins, and both arms overwrite advice. | `ccd/session-hook.sh#_hook_mail_hold` |
| `marker-read-bytes-verbatim` | A default `read` trims blanks and stops at a newline, so the hook accepted corpus rows the owner refuses (a leading or trailing blank, a tab, a newline). The read is `IFS= read -r -d '' -n 256`. Its bound is 256, past the longest valid value (195), because `single-definition/ask-digest.test.ts` refuses a hand-kept 512 in the hook. | `ccd/session-hook.sh#_hook_mail_hold` |
| `dollar-paren-subsumed` | Table 6's `$(` row cannot red: the `(` in the head's separator class already reads the `(` of `$(`. `GH_MERGE_RE` has the same alternative, and the module copies its grammar, so the alternative stays. An equivalent mutant. | `ccd/lib/mail-hold.jq#mh_head`, `ccd/session-hook.sh#GH_MERGE_RE` |
| `origin-main-subsumed` | The `origin main` target cannot red: `main` after an `origin` argument already matches. `LANDING_SYNC_RE` has the same alternative. An equivalent mutant at the first tip. Since fix round 1 the same alternative carries `+main` and `main:<dst>` (F13), so its mutant reds. | `ccd/lib/mail-hold.jq#mh_target` |
| `overcap-kinds-gh-merge` | P6 names four over-cap kinds (push, commit, sync, admin-merge). The module's raw read finds `gh pr merge` too, because A covers a coordinator, whom the merge deny's own over-cap read does not refuse. A superset in kinds. Fix round 1 made it a superset in matches too, except for the shapes section 6 lists (review 2788, F2). | `ccd/lib/mail-hold.jq#mh_rawacts` |
| `unfinished-strip-raw-read` | "Fail closed on an unterminated quote" is built as: a strip answer that still holds a quote (the strip keeps an unterminated span raw) is read twice, on the stripped text and word by word on the raw text, and the acts are the union (fix round 1, F2: the raw read alone lost denies the stripped read makes). No answer at all is read word by word on the raw text, as over the cap. | `ccd/lib/mail-hold.jq#mail_hold` |
| `notice-on-gated-when-a-shadow` | With E armed and A shadow, a gated main-thread call gets E's line and logs `refuse would`. The spec says E is said on "every other" call; while A is shadow nothing refuses the call, so E still tells the session about the mail. | `ccd/lib/mail-hold.jq#mail_hold` |
| `module-missing-arm-dash` | The `module-missing` line's arm field is `-`: the module decides the arm, so the hook cannot name one when the module is absent. | `ccd/session-hook.sh#_hook_mail_hold` |
| `first-pair-named` | E's and A's texts, and every log line, name the marker's first pair. The writer sorts pairs by delivery id, so that is the lowest. | `ccd/lib/mail-hold.jq#mail_hold` |
| `stop-line-on-any-marker` | The `Stop` line is written whenever a marker file stands (P9), lapsed, far or malformed included, with `-` as the delivery when the marker does not parse. Under `mail-disabled` it is not written. | `ccd/session-hook.sh#_hook_mail_hold` |
| `rig-module-planted-by-stub` | The rig copies only `session-hook.sh` into its fixture HOME, so the asserting case plants the module with a stub. Copying `ccd/lib` whole would also load the roster card and transcript modules, which would change what other scenarios measure. | `server/test/delegation-rig/stubs/mailhold-plant.sh`, `rig.sh` (`cmd_setup`) |

*Table 5. Departures. The plan's own `last-deny-arm` and `overcap-kinds-in-module` hold as written; `case … )` stays a
residual, inherited from the merge deny.*

## 6. Fix round 1 (review 2788)

The review read the first tip, `9108405b5`. Everything still ships shadow, so these findings matter once A is armed.

| Finding | What changed | Where |
|---|---|---|
| F1, F5: the target was re-read on the raw text, not tied to the verb's head | A sync's target is read on the stripped text, from the verb to its command's end (`mh_tok` crosses `$(…)` and is tried first, so a greedy loop never stops at its `(`). A target in quoted prose, a heredoc body or another command holds nothing. | `ccd/lib/mail-hold.jq#mh_acts` |
| The quoted target the strip removes | `mh_prep` unquotes each quoted span of plain word characters (`"main"`, `'origin/main'`, `"HEAD"`), which bash reads as the same word. The hook runs it before MERGE_STRIP_JQ in its own strip call (`include "mail-hold"; mh_prep \| <strip>`), and the strip's text is unchanged (its sha256 test passes). As a side effect, `"git" push` is read as a push. | `ccd/lib/mail-hold.jq#mh_prep`, `ccd/session-hook.sh#_hook_mail_hold` |
| F2: over the cap, `$(…)` split a segment | The raw read's segments end at `;` `&` `\|` and newlines, never inside a `"…"` span or a `$(…)` (to its first `)`). An unfinished strip reads the union of the stripped and raw reads. | `ccd/lib/mail-hold.jq#mh_rawacts`, `#mail_hold` |
| F3: any `-…` word took an argument | Only git's `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--config-env`, `--exec-path` and `--super-prefix`, and gh's `-R` and `--repo`, take the next word, in the separate-word form. The empty word a stripped quoted argument leaves (`-C "my repo"` strips to `-C  pull`) counts as that argument. | `ccd/lib/mail-hold.jq#mh_opts` |
| F4: a quoted `HEAD` after `origin` | Read through `mh_prep`. `LANDING_SYNC_RE` has the same gap; it is the landing advisory's rule, so it is recorded here as a residual and not changed. | `ccd/session-hook.sh` (`LANDING_SYNC_RE`) |
| F13 (ruling) | Also naming main: `refs/heads/main`, `refs/remotes/origin/main`, `origin/main` with a `~N` or `^N` suffix, a `main:<dst>` or `+main` refspec after `origin`, and any of these after `--onto=` or `--onto`. | `ccd/lib/mail-hold.jq#mh_target` |
| F6 | The module header lists the residuals the review measured (below). | `ccd/lib/mail-hold.jq` |
| F7: the pre-filter read the whole payload | It reads the command with builtins, from `"command":"` to the next `","` (no JSON string holds that sequence), so a working directory or a description naming a verb starts no strip. | `ccd/session-hook.sh#_hook_mail_hold` |
| F9, F10 | The rig mutants ran on all three builds, and the scenario's regexes refuse appended text (section 4 and below). | `ov-pretool-notice.json`, `delegation-rig.test.ts` |
| The hook's placement comment | It now gives the true reason, the growth counter's false heredoc. | `ccd/session-hook.sh#_hook_mail_hold` |

*Table 6. Fix round 1.*

**Red first.** With the old module (plus an identity `mh_prep`), 53 of the module suite's 167 cases are red, each a shape the review measured.

**Mutations.** Ninety-six mutants were each an in-place edit, restored from a saved copy and sha256-checked after the restore (N1). Table 2's rows were run again on the changed module, and the new rows are one per new guard. 95 went red. The one survivor is `dollar-paren-subsumed`. `origin-main-subsumed` no longer survives (Table 5).

| New guard | Mutant | Result |
|---|---|---|
| `mh_tok` tries `$(…)` first | the two alternatives swapped | red: `git pull $(echo origin) main` |
| The target read crosses `$(…)` | a plain word class | red: `git merge -m $(date +%F) main` |
| The target in the verb's own command | the rest of the text | red: the four "outside the verb" cases |
| The empty word as an option's argument | dropped | red: both `-C "my repo"` cases |
| Options by the closed lists | the old shape; an argument option also argless | red: the seven F3 cases; then `git -C push status` |
| Each argument option (8 git, 2 gh) | dropped from its list | each red: its own row |
| Each F13 form (`--onto=`, `~N`/`^N`, `+main`, `main:<dst>`, `refs/heads/main`, `refs/remotes/origin/main`) | dropped | each red: its own row |
| `mh_unq` | no unquoting; a blank, then a `;`, in its class | red: the quoted-target cases; then the class case twice |
| The hook composes `mh_prep` | the strip alone | red: the hook's end-to-end quoted-target case |
| Raw segments keep `"…"`, keep `$(…)`, never split at `(` `)`, and still split | each undone | each red: its padded case; the CONTROL |
| The union on an unfinished strip | the raw read alone; the stripped read alone | red: the union case; the unterminated-quote case |
| F7's builtin read; its cut at the command's end | the whole payload; no cut | red: the pre-filter case, both times |
| F10's end anchor; its trailer | appended text allowed; no trailer allowed | red: the scenario regex case, both times |

*Table 7. Fix round 1's new mutants. Table 2's rows re-run on the changed module, each still red, are not repeated.*

**Over the cap, a superset, with these exceptions.** A gated act whose words a separator inside a '…' span splits stays unread over the cap (`git -c 'a;b' push` padded past the cap). It is left that way on purpose: kept whole, an apostrophe in a long body's prose would join the rest of it into one segment and refuse far more. A separator in a nested `$(…)`, an escaped separator and a `\"` inside a `"…"` span can also split. Under the cap, a `$(…)` that holds a separator between an act's words (`git -C $(cd x; pwd) push`) is missed, as `GH_MERGE_RE` misses it. The raw read refuses it over the cap.

**Residuals of an accident guard** (F6 and F13's ruling, in the module header):
- a head after `case … )`;
- backtick substitution;
- a backslash-newline inside a command;
- an escaped or partly quoted command word or verb;
- wrappers outside the head grammar, wrapper flags and path-spelled wrappers;
- leading redirections;
- function bodies, `eval`, `bash -c`, a heredoc fed to a shell, and `xargs`;
- a git alias;
- `FETCH_HEAD`, `@{u}`, `upstream/main` and a bare `git pull`.

**Recorded as the report states (F11, F12).** F11: the marker read stops at the first NUL, so a value followed by a NUL and junk reads `live` where `parseMailHold` refuses it. ccd's writer (`printf '%s'` from argv) cannot produce it, and a file over 256 bytes cannot validate. F12: a joined subagent's over-cap refusal gets no over-cap advice, and over the cap, prose such as `echo "use git then push later"` is refused, which is the documented over-cap cost. F8, the cost table's labelled scope, is accepted as written.

## Where things stand

### Agreed

- Tasks 5.1 to 5.4 and Task 3.3's hook arm, built as the plan and the brief's rulings say (N1, N2, N13, D3, and PR 0's
  review carries).

### Waiting on you

- The coordinator: minting numbers for the slugs in Table 5, if any are wanted.

### Later

- PR 4's projection writes the marker; PR 6 adds the subagent ack refusal to the same module and function.
- Arming E, then A, by the operator's hand (plan §7).
- The growth counter's false heredoc (`growth-counter-false-heredoc`), a fix for the growth check's owner.
