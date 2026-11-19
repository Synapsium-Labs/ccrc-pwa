# Overlord wave 182, mid-turn mail PR 6: notes for the ledger

This note records what PR 6 of the mid-turn mail plan (`docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, Task 6.1)
built and measured, and the departures found, by slug. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Built:** the subagent's ack refusal (spec §3.5, D10). In a joined subagent, `ccrc-api mail ack`, and every
  `ccrc-api mail inbox` whose standard output is not a pipe or `/dev/null`, is refused with the spec's fixed text, with
  or without a marker. The matcher and the text are in `ccd/lib/mail-hold.jq` (`mh_ack`, `mh_shows`, `mh_ackacts`,
  `mh_ack_refuse`), read on the raw command text. The arm is in `_hook_mail_hold`, behind a builtin prefilter.
- **It ships shadow.** With `mailhold-refuse-live` absent nothing is refused, and the shadow log records `ack would`
  once per key, with `-` for the delivery when no marker parses. Nothing in the tree writes that marker; PR 5's
  single-definition scan still holds that.
- **Growth,** by the growth check's own counter against the merge base `9f7e5c203`: `ccd/session-hook.sh` **+2** (the
  plan estimated +8). `growth-check` passes armed, with no waiver. A `.jq` file is in no growth row.
- **Mutations:** Task 6.1's eight, each red, and three more for guards the task did not list, each red (section 3).
- **Cost:** a call the prefilter stops spawns nothing new; an inbox that only shows adds one `jq` call (the module),
  and a refused ack two (the module and the envelope) (section 4).

## 1. What runs where

| Piece | Where | What it does |
|---|---|---|
| The prefilter | `ccd/session-hook.sh#_hook_mail_hold` | builtins only: a joined subagent (`tmsub`), a `PreToolUse` Bash call, and a command holding `mail`, and `ack` or `inbox` (read from `"command":"` to the next `","`, as F7's read does) sets `k` |
| The entry | the same function | it runs on a marker file (`m`) or on `k`; `$REG/mail-disabled` still darkens it; the marker is read only when `m` is set; the strip runs only when a marker parsed |
| The matcher | `ccd/lib/mail-hold.jq#mh_ackacts` | on the raw text: the merge deny's head grammar (`mh_head`), then a word ending in `ccrc-api` (bare, quoted, with a path) or a variable (`$API`, `"${API}"`), then `mail ack` or `mail inbox` |
| Whether an inbox only shows | `ccd/lib/mail-hold.jq#mh_shows` | the last redirection of standard output must name `/dev/null`; with none, the command must end at `\|` or `\|&`; anything else acks |
| The text | `ccd/lib/mail-hold.jq#mh_ack_refuse` | the spec's text, byte for byte, wrapped by `_hook_deny_json` (N13) |
| The arming | `ccd/lib/mail-hold.jq#mail_hold` | `refuse` (`$REG/mailhold-refuse-live`): `ack did`; unarmed: `ack would`, nothing refused |

*Table 1. PR 6's pieces.*

## 2. Tests

Red first: with the module and hook of `main`, 55 of the module suite's 282 cases and 14 of the hook suite's 53 were
red, every one of them new. The new cases:

- **Refused in a joined subagent, with no marker and under a live one:** `mail ack`, bare `mail inbox`, `> f`, `>> f`,
  `&> f`, `>&2`, `2>/dev/null`, `"$API"`, `$API`, `"${API}"`, a path to `ccrc-api` (bare, under `~`, and inside
  `"$HOME/…"`), `x=$(ccrc-api mail inbox)`, `echo "x; ccrc-api mail ack"`, after `cd x &&`, `> /dev/null >&2`,
  `> f | cat`, `; echo done`, and a second command after a `mail list | cat`.
- **Passed:** `| cat`, `> /dev/null`, `mail list`, `mail fetch 7`, `"$API" mail inbox | head -5`, `2>&1 | cat`,
  `>/dev/null 2>&1`, `&>/dev/null`, `|& cat`, `1> "/dev/null"`, and three look-alikes (`echo mail inbox`,
  `mail inboxes`, `grep ack mail.txt`).
- **Passed on the main thread and for an unjoined `agent_id`,** with no marker and under one (where E's line is said).
- **The raw read:** with the strip's answer given, `"$API" mail inbox` is still refused.
- **Shadow:** `ack would` once a key, `-` with no marker, the delivery under one.
- **In the hook:** the text through `_hook_deny_json`, byte for byte; the prefilter makes no call of the block for
  `ls`, `mail list` or `grep -r inbox notes` in a joined subagent, and one for `mail inbox | cat`; `mail-disabled`
  refuses nothing; a missing module refuses nothing and logs `module-missing` once with no marker.

| Suite (from `server/`, one file at a time, through `ccrc test`) | Result | Seconds |
|---|---|---|
| `mail-hold-module` | 282 passed | 3 |
| `session-hook-mail-hold` | 53 passed | 10 |
| `mailhold-parity` | 9 passed | 3 |
| `session-hook-merge-deny` (its jq 1.8 `as` guard scans the module) | 243 passed | 21 |
| `single-definition/mail-hold` | 7 passed | 1 |
| `session-hook-sync-advisory` | 78 passed | 3 |
| `anchors` | 9 passed | 2 |
| `citations` | 4 passed | 1 |
| `dtbd` | 1 passed | 1 |
| `docs-grammar` | 158 passed | 2 |
| `topology-clean` | 61 passed | 14 |
| `growth-check` (armed) | 97 passed | 8 |
| `deviation-refs` (after `git fetch origin main`) | 34 passed | 15 |

*Table 2. The suites the brief names, and "Every PR". Wall time of each `ccrc test` run.*

**Spawns.** The module suite's two helpers, `strip` and `hold`, now carry a 30 s timeout and `SIGKILL`, because every
new case runs through them (the coordinator's ruling on PR 5's untimed spawns). The new hook cases run through the
suite's `run`, which already has its 60 s bound, and the one new shell spawn there goes through `spawnSyncGroup` with a
10 s timeout, which kills its whole process group on expiry. PR 5's other untimed
calls in these files stay as recorded: two in the module suite and three in the hook suite.

## 3. Mutations (Task 6.1)

Each mutant was an in-place edit, restored from a saved copy whose sha256 was checked after the restore (N1). Each ran
the suites named, through `ccrc test`.

| Guard | Mutant | Result |
|---|---|---|
| The `tmsub` test | dropped from the prefilter | red: the main-thread pass case |
| No marker needed | the arm gated on a live marker | red: every no-marker refusal |
| `2>/dev/null` acks | descriptor 2 read as standard output | red: its case |
| `>&2` acks | a duplication read as `/dev/null` | red: its case |
| Only `/dev/null` shows | any target read as showing | red: the `> f` case |
| The variable head | dropped | red: `"$API"`, `$API`, `"${API}"` |
| The raw text | the stripped text read instead | red: `"$API"` (the strip empties it) |
| The arm's marker | `notice` tested for the arm | red: the shadow case |
| The prefilter's `mail` word (beyond the task) | dropped | red: the prefilter case (`grep -r inbox notes` calls the module) |
| A seen text with no pairs (beyond the task) | its `-n "$seen"` dropped | red: the missing-module case (logged on every call) |
| Empty pairs (beyond the task) | the `// ""` guard dropped | red: every no-marker case (jq fails on `null \| split`) |

*Table 3. 11 mutants, 11 red, none surviving.*

## 4. Cost

Measured in a fixture HOME on the fleet box, 200 `PreToolUse` calls of each kind through the real hook, each call one
`bash` process timed whole, both arming markers standing, at a load average of about 7. The same script ran over
`main`'s hook (`9f7e5c203`) and this PR's. No assertion is written on the numbers.

| Kind | `main` p50 / p95 ms | PR 6 p50 / p95 ms | jq calls, `main` → PR 6 |
|---|---|---|---|
| No marker, main thread, a Read | 18.7 / 21.3 | 18.0 / 20.5 | 6 → 6 |
| No marker, main thread, Bash `ls` | 15.5 / 17.1 | 15.6 / 18.3 | 4 → 4 |
| No marker, joined subagent, Bash `ls` | 17.1 / 19.1 | 17.2 / 20.2 | 5 → 5 |
| No marker, joined subagent, `mail list` (the prefilter stops it) | 16.9 / 18.7 | 17.1 / 19.0 | 5 → 5 |
| No marker, joined subagent, `mail inbox \| cat` (passes) | 16.8 / 18.5 | 21.0 / 25.5 | 5 → 6 |
| No marker, joined subagent, `mail ack` (refused) | 16.7 / 18.3 | 22.5 / 24.8 | 5 → 7 |
| A live marker, main thread, a Read | 23.4 / 26.7 | 23.6 / 25.6 | 8 → 8 |

*Table 4. The hook's cost before and after.*

- **A call the prefilter stops adds no `jq` call.** The pinned count in `session-hook-mail-hold.test.ts`, 6 for an
  ungated main-thread Read with no marker, is unchanged.
- **A joined subagent's call the prefilter passes adds the module** (about 4 ms at the median), and a refusal adds the
  envelope too (about 6 ms). These are the calls that name `mail` and `ack` or `inbox`, rare in a subagent.

## 5. Departures, by slug

| Slug | Finding | Where |
|---|---|---|
| `ack-refusal-dark-under-mail-disabled` | `$REG/mail-disabled` darkens the ack refusal too. It is `_hook_mail_hold`'s one switch, and the spec makes the ack refusal an exception only to "first tests for a live marker". | `ccd/session-hook.sh#_hook_mail_hold` |
| `ack-delivery-from-a-parsed-marker` | The `ack` log line names the marker's first delivery whenever the marker parses, a lapsed or far one included, and `-` only when none parses. | `ccd/lib/mail-hold.jq#mail_hold` |
| `gated-refusal-wins-over-ack` | In a joined subagent under a live marker with A armed, a command holding both a gated act and an acking form gets A's subagent text. Both lines are logged. | `ccd/lib/mail-hold.jq#mail_hold` |
| `ack-shows-by-last-stdout-redirect` | "Standard output goes to a pipe or to `/dev/null`" is read as: the last redirection of standard output names `/dev/null`, or, with none, the command ends at `\|` or `\|&`. So `&>/dev/null`, `1> "/dev/null"` and `\|&` pass, as `cmd_inbox` only shows for them. Stricter than `cmd_inbox`: a FIFO target, `1>&-`, and an inbox inside `( … ) \| cat` or `{ …; } \| cat` are refused. | `ccd/lib/mail-hold.jq#mh_shows` |
| `ack-word-end-includes-quotes` | `mh_end` does not end a word at a quote, so the ack matcher ends its verb at a quote too; without that, `echo "x; ccrc-api mail ack"` (Task 6.1's fail-closed form) is not read. | `ccd/lib/mail-hold.jq#mh_ack` |
| `seen-text-for-no-pairs` | With no marker the pairs are empty, so a seen text opens with an empty line. The hook's `module-missing` key now starts a seen text with its pairs line even when the pairs are empty; before, an empty seen text kept no pairs line, which no case reached while every call had a marker. | `ccd/session-hook.sh#_hook_mail_hold` |
| `module-pairs-empty-guard` | `mail_hold` split the first pair with no guard, so empty pairs failed in jq. It now reads an empty first pair, and the sender is then none. | `ccd/lib/mail-hold.jq#mail_hold` |

*Table 5. Departures. The plan's own `ack-substitution-stricter` holds as written: `x=$(ccrc-api mail inbox)` is
refused.*

**Residuals of an accident guard,** in the module beside PR 5's: a head the merge deny's grammar does not read
(after `case … )`, an escaped or unlisted wrapper, `eval`, `bash -c`, a script); a `ccrc-api` reached through a
substitution (`$(command -v ccrc-api) mail ack`) or an alias; options between `ccrc-api` and `mail`; and an `exec > f`
earlier in the shell, which the matcher cannot see.

## 6. The first CI run, and Horkos

- **The first fast run was red** on `a84f22c49`, in `spawn-group-pin.test.ts` (shard 4): the one new
  `sh -c 'command -v jq'` call in the hook suite carried a timeout through plain `spawnSync`, and a timed shell spawn in
  `server/test` must go through `spawnSyncGroup` (#896). It now does; `spawn-group-pin` and `session-hook-mail-hold`
  pass alone (11 s and 12 s). The module suite's `jq` spawns are not shells, so the pin does not count them.
- **Horkos answers red with two blocking reasons this PR cannot fix itself.** `rules-mixed`: it reads
  `ccd/session-hook.sh` as a rules file, which a PR may not change beside other files; `code-owner-approval-needed`
  follows from the same file. Clearing them would split the hook's two-line change into a PR of its own, away from the
  module and tests it calls. That is a structure call for the coordinator. PR 5 (#3067) carried the same red and
  landed; Horkos is not a required check.

## Where things stand

### Agreed

- Task 6.1, built as the plan and the brief's rulings say (N1, N2, N13, D3).

### Waiting on you

- The coordinator: minting numbers for the slugs in Table 5, if any are wanted.
- The coordinator: whether Horkos's `rules-mixed` asks for the hook's lines in a PR of their own (section 6).

### Later

- Arming A and the ack refusal together, by the operator's hand (plan §7), after PR 5's checklist.
- Bounding PR 5's remaining untimed spawns in these suites.
