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
| The matcher | `ccd/lib/mail-hold.jq#mh_ackacts` | on the raw text after `mh_unq`: the merge deny's head grammar (`mh_head`), then a word ending in `ccrc-api` (bare, quoted, with a path) or a parameter expansion (`$API`, `"${API}"`, `"${CCRC_API:-ccrc-api}"`), then `mail ack` (and the delivery it names) or `mail inbox` with its run of blanks and redirections, and a look at what ends that run, in one pass |
| Whether an inbox only shows | `ccd/lib/mail-hold.jq#mh_shows` | from that run alone: the last redirection of standard output must name `/dev/null`; with none, the command must end at `\|` or `\|&`; anything else acks |
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
substitution (`$(command -v ccrc-api) mail ack`) or an alias; an ANSI-C quoted verb (`mail $'ack'`, which `mh_unq` does
not read); and an `exec > f` earlier in the shell, which the matcher cannot see. An option between `ccrc-api` and `mail`
is no residual (review 2826 F5): `ccrc-api` takes the group as its first argument, so that form is an unknown verb and
acks nothing, and the matcher rightly passes it.

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

## 7. Fix round 1 (review 2826)

The review read `a1cf675f3`. Nothing in it blocked landing: the arm ships shadow.

| Finding | What changed | Where |
|---|---|---|
| F1: the ack read was superlinear | `mail inbox` takes no argument, so the match itself reads only the run of blanks and redirections after `inbox` (`r`) and looks at what ends it (`e`, a lookahead, so the next command's head is still read). Nothing past the run is read and nothing is sliced per match. 20 KB of `ccrc-api mail inbox \| cat; ` repeated: 13.1 s before, 27 ms after (jq 1.8.1, load about 11). A module case bounds it at 500 ms. | `ccd/lib/mail-hold.jq#mh_ack`, `#mh_shows`, `#mh_ackacts` |
| F2: a comment, and `{fd}>` | The run stops at the first word that is not a redirection, so `# … \| grep` and `#  >/dev/null …` end it with no pipe; `{name}>` is a redirection of another descriptor. Cases for (a) to (c). | `ccd/lib/mail-hold.jq#mh_redir`, `#mh_shows` |
| F3: a parameter expansion as the command word | `\$\{[^}\s]*\}` is a variable head, so `"${CCRC_API:-ccrc-api}" mail ack 5` and `${API:-ccrc-api} mail ack 5` are refused. | `ccd/lib/mail-hold.jq#mh_ack` |
| F4: quoting inside the verb words | The matcher reads `mh_unq` of the raw text, as the gated acts' strip does, so `mail "ack"`, `a"ck"`, `"mail" inbox`, `'mail' ack` and `"inbox" > "f"` are refused. `mail $'ack'` stays a named residual with its own case. | `ccd/lib/mail-hold.jq#mh_ackacts` |
| F5 | The "options between `ccrc-api` and `mail`" residual is dropped from the module and this note; `ccrc-api --json mail ack 1` is a pass case. | `ccd/lib/mail-hold.jq`, section 5 |
| F6 | No change. The arming review counts these fail-closed refusals from the shadow log: a `grep` or `git log` pattern holding `ccrc-api mail ack` or `mail inbox`, a heredoc body line, a `printf` of one, `#ccrc-api mail ack`, and `mail inbox >/dev/null 2>&1 1>&2`, each of which acks nothing. | plan §7 |
| F7 (ruled): the line names what the command named | `mail ack <n>` logs `ack would <n>` and its seen key carries `<n>`, so `ack 5` and `ack 6` under one marker are two lines; `mail ack` with no plain id logs `-`. A bare inbox that acks logs one line per delivery the marker holds (it acks them all), or `-` when no marker parses. Every refused act in one command is logged, and a repeated one once. Plan §7's exclusion now reads the delivery itself. | `ccd/lib/mail-hold.jq#mail_hold` |
| F8 | No change. `ack would` is logged once per key within one pairs epoch (PR 5's seen design), so a week's count of `ack would` lines counts epochs, not acks. | plan §7 |
| F9 | The module's ack branch also requires a subagent thread, so a wrongly set `ack` on the main thread refuses nothing. The hook's `tmsub` test stays a cost guard, held by a hook case: a main-thread `mail inbox` with no marker makes no call of the block. | `ccd/lib/mail-hold.jq#mail_hold`, `server/test/session-hook-mail-hold.test.ts` |
| F10 | No change. | |

*Table 6. Fix round 1.*

**Red first.** With round 0's module (`a1cf675f3`), 34 of the module suite's 313 cases and 3 of the hook suite's 53 were
red, each a shape of this round.

**Mutations.** 21 mutants, each an in-place edit restored from a saved copy with its sha256 checked (N1): Table 3's 11
re-run on the changed code, and 10 for the new guards. All 21 red. The first try at F2a (dropping `#` from the
terminators) survived, because the run already stops at any word that is not a redirection; that alternative was
redundant and is gone, and the guard's mutant lets the run take any word, which reds the comment cases.

| New guard | Mutant | Result |
|---|---|---|
| F1, the linear read | the rest of the command read again after every match | red: the 20 KB case (1.4 s against its 500 ms bound) |
| F2a, the run takes only redirections | the run also takes any word | red: both comment cases |
| F2c, `{fd}` is another descriptor | `{name}` dropped from `mh_shows`'s descriptors | red: the `{fd}>/dev/null` case |
| F3, the parameter expansion head | the old `\$\{?name\}?` head | red: both `:-` cases |
| F4, unquote first | `mh_unq` dropped | red: the quoted-verb cases |
| F7a, an ack names its delivery | every ack logs `-` | red: the two-acks case, and the hook's |
| F7b, an inbox names every delivery | only the first | red: the three-deliveries case |
| F7c, every refused act | only the first | red: the every-act case |
| F7d, a repeated key once | no dedupe in one call | red: the every-act case |
| F9, the module tests the thread | the thread test dropped | red: the F9 case |
| The hook's `tmsub` test (Table 3, row 1, re-run) | dropped | red: the prefilter case's main-thread call |

*Table 7. Fix round 1's new mutants.*

**Suites** (from `server/`, one at a time, through `ccrc test`): `mail-hold-module` 313 passed (4 s),
`session-hook-mail-hold` 53 (12 s), `mailhold-parity` 9 (2 s), the merge deny's suite 243 (20 s),
`single-definition/mail-hold` 7 (2 s), `spawn-group-pin` 12 (11 s), `growth-check` armed 97 (8 s).

**Cost,** the same bench as section 4, at a load average of about 11 (the base run was noisy, p95 up to 70 ms on calls
the change does not reach): the `jq` calls per kind are unchanged from section 4 (6, 4, 5, 5, 6, 7, 8); a joined
subagent's inbox that only shows took 22.3 ms at the median and a refused ack 23.6 ms. The hook is unchanged in this
round, so its growth stays +2.

## Where things stand

### Agreed

- Task 6.1, built as the plan and the brief's rulings say (N1, N2, N13, D3).

### Waiting on you

- The coordinator: minting numbers for the slugs in Table 5, if any are wanted.
- The coordinator: whether Horkos's `rules-mixed` asks for the hook's lines in a PR of their own (section 6).

### Later

- Arming A and the ack refusal together, by the operator's hand (plan §7), after PR 5's checklist.
- Bounding PR 5's remaining untimed spawns in these suites.
