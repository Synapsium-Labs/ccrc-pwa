# Landing order wave 3b: notes for the ledger

This note lists every departure from the plan and every ruling the worker made while executing it (run 310, branch
`ws/clear-ridge`). The plan file and the programme ledger are untouched; the coordinator folds this note in on its
ledger pull request.

## Departures from the plan

| # | Plan text | What shipped | Why |
|---|---|---|---|
| R3 | "The tick" step 1: `exec python3 -I - <<'PY'` | `exec python3 -I /dev/fd/3 3<<'PY'`, and with `CCD_LAND_PROBE_SELFTEST=git_ro` the head skips the pause, the tool check, the mkdir and the lock | With `-` the program reads itself from stdin, so the self-test could never read a JSON line from it. |
| R6 | The plan does not say what a failed `gh pr list` does to main-health and the lineage | The probe reads `unmeasured`, `why: gh-failed`, with empty heads and pairs. The base is still fetched, and main-health and the lineage are measured against it | Neither needs the PR list. |
| R7 | The final review proposed a new probe why word, `error` | No new why word. The step-9 rewrite of `probe` runs unconditionally. Doctor treats a null store figure as "not measured this tick", and WARNs `land-probe-incomplete` when a finished tick wrote no main-health | The probe's why set (Design, "probe" format) is a settled format. |
| R5 (fix round 1) | "The git door": layer 1 refuses a literal prefix list of caller options (`OPTION_PREFIXES`) | Layer 1 is an allowlist of option FORMS per `where` and subcommand (`OPTION_FORMS`): each subcommand admits only the exact spellings the probe's own call sites pass, compared whole, and an element outside the list answers `option <opt>`. The prefix list stays as the first rule, so the existing reasons are unchanged. A form is checked wherever its element stands, before an operand or after one. `--` is admitted for the fetch alone, and after it the door refuses every element that starts with `-` (`option <opt>`; fix round 2, review 1125 item 6) | The prefix list let a file-writing option (`rev-list --output=<file>`), a long-option abbreviation (`--upload-pa=<cmd>`) and `cat-file --textconv`/`--filters` pass. None is reachable from a call site today; the rule is now as strong as its stated aim (review 1109, F2 and A9). |
| gh child (fix round 1) | The scrub "for every child" | The forge child's environment also drops every `GIT_*` variable and sets `GIT_TERMINAL_PROMPT=0`, besides dropping `GH_REPO` and `GH_HOST` | The plan's scrub is stated for every child, and gh is one (review 1109, A11). |
| enabled (fix round 1) | The tick, step 4.4.8: `enabled` is written or removed inside each project's measuring, and step 5 sweeps the directories with no conf | One pre-pass at the start of the tick, after the global pause check (the bash head) and the stale-scratch clearing, before any project is measured: over every conf and every directory under `$REG/landing/` it writes `enabled` (valid conf, `lineage=on`, unpaused, a real main checkout) or removes it in every other case, and it absorbs step 5's sweep. The measuring loop no longer writes or removes `enabled`. The tick's steps are now: 1 head, 2 signals and stale scratch, 3 the pre-pass, 4 each project (4.4.8 gone), 5 exit | The spacing of two writes of `enabled` is the spacing of tick starts, whatever the project order and budgets (review 1109 measured up to 1110 s with four projects). Wave 4 bounds freshness at three intervals (900 s) |
| rules read (fix round 1) | `GET repos/<slug>/rules/branches/<base>` read once | The read is `--paginate`, and its parse accepts several concatenated pages as the check-runs read does. The fixture stub pages this endpoint by two | A `required_status_checks` rule beyond page 1 was dropped, and a failing required check could read green (review 1109, F1). The siblings that read the same endpoint one page (`ccd/ccd`, `deploy/measure-landing.py`) are not this wave's and are carried to the ledger |
| exit paths (fix rounds 1 and 2) | SIGTERM runs the cleanup | Since fix round 2 a SIGTERM or SIGINT never raises where it lands. `on_signal` records the first signal and SIGKILLs the process group of the child in flight with `os.killpg` alone (skipping a child already reaped); it never raises, waits, reaps or clears `CHILD`. `run_child` starts no child once a signal is recorded (its test sits inside the spawn mask) and never raises. The interruption, `SystemExit(128 + signum)`, is raised by `checkpoint` alone: after each child the measuring code starts returns (a literal pin holds every such site), before the pre-pass, before each project and once after the projects loop. That last one runs with SIGTERM and SIGINT held, and the exit status reads a signal still pending under the hold, so a signal after the last checkpoint still exits 128 plus its number. The fallback and the closing path run with `CLOSING` set, let go in a `finally` of its own so a closing path that raises cannot leave every later checkpoint dead, so no checkpoint raises there: the closing rewrite (an interrupted record, R7's nulls, once a signal is recorded), the kill of any child in flight and `remove_scratch` always run to their end, and so do `make_scratch`, the stale sweep and `write_json`. The closing path's own mask is gone: nothing in it can be interrupted any more. SIGTERM and SIGINT stay blocked from before the signal test until `CHILD` is set, and the child resets both to their defaults before it unblocks them; a `SubprocessError` from `Popen` is a spawn failure. The before-first-write fallback kills the child in flight before it starts one of its own. A `make_scratch` failure after `mkdtemp` removes the directory it made. One journal line changes: a signal in the closing rewrite no longer logs `the closing probe rewrite stopped (SystemExit)`, because the rewrite now finishes. Two behaviours change, and only a signal reaches them: an ordinary exception that follows a recorded signal is an interrupted tick (no fallback runs, the old records stand, and `handle_project` logs `project-error <project>: <exception>`), as round 1's raising handler made it; and a signal during the before-first-write fallback no longer cuts it short: the fallback finishes, reading its rows one at a time. A row read after the signal was recorded is refused, or killed by the handler if its read is in flight, so it is undecided (fix round 3): with an old lineage file it is rewritten unmeasured with `tip: null` (one `unmeasured <project> <id>.lineage fetch-failed` line), which wave 4 reads as `lineage-unmeasured` (departure 3). A row read before the signal with rc 0 and 40 hex qualifies, and is rewritten unmeasured with the tip it read, even when it had no old file; so is a read that exited 0 but was not yet reaped when the handler ran. A row answered rc 1 before the signal is decided, and its old file is pruned. Held rows, and every row when the registry cannot be listed, are untouched (fix round 4, review 1143 F2). Kept that way: the fallback's records are true (nothing was measured) and the rule that no old record outlives a failed tick is the stricter one | A signal in the closing rewrite left the scratch and a live child, and a signal between the fork and the assignment left a child nobody killed (review 1109, F4, A1, A2). Round 1's masks narrowed the windows but could not close them, because CPython runs a pending handler inside `pthread_sigmask` itself: a raise in the except body, in `kill_inflight`, after `mkdtemp`, after `mkstemp` or in the stale sweep's removal still left a scratch, a temp file or a live child (review 1125, A1, A2, A3, A4, A6, F1, N3) |
| self-signal points (fix round 2) | No such knob | `CCD_LAND_PROBE_SELFSIGNAL=<point>` (test-only: no tracked file but the probe, the tests and these notes names it, and a pin reads every tracked file, fix round 3) makes the probe send itself one SIGTERM at a named point: `except-log`, `mkdtemp`, `mkstemp`, `killpg` (inside the handler, the new code's equivalent of round 1's `kill_inflight` window), `spawn` (between the fork and the record) and `exit` (after the last checkpoint, under the final hold). `write_json` binds `tmp` from `mkstemp`'s answer one statement later, so the `mkstemp` point sits in the window the review named. The stale sweep has no point in the probe: its case wraps `os.unlink` (which `shutil.rmtree` calls at call time) and sends the signal after the first file the removal deletes, so it lands inside the removal (fix round 2's scoped review, m4) | The ruling's cases need a signal at a fixed point; an external signal cannot hit one |
| failure records (fix round 1) | A failed or timed-out fetch rewrites every qualifying row's lineage unmeasured | Also when the project budget cut the fetch: a row whose local read the spent budget left undecided is rewritten unmeasured (`fetch-failed`, `tip: null`) when it has an old file, and no new file is invented. The probe and main-health say `why: budget` when the budget is the cause. An exception or refusal before the first write writes `probe`, `main-health` and the lineages unmeasured (`fetch-failed`). Since fix round 4 an old lineage outlives a failed fetch only when the registry cannot be listed, when its registry row is held (its `.project` or `.branch` cannot be read, or, since fix round 5, its `.branch` names no well-formed `ws/` branch), or when a signal recorded before the last read checkpoint its route passes through ends the tick (review 1143 F5, F6, A6; review 1158 F2, F4; the "held rows" row below). A conf `base` the key rule would refuse is `conf-invalid: bad-value` at parse. `repo-unreadable` writes main-health `why: fetch-failed`, not `gh-failed` | No old record may outlive a failed measurement as if it were this tick's; `budget` is the Design's word; `fetch-failed` is in the plan's set and `gh-failed` was not true when no gh call was made (review 1109, F6, A3, A5, A12) |
| undecided rows (fix round 3) | A row qualifies when `refs/heads/<branch>` resolves; a read that timed out or ran past the budget leaves it undecided | Only two answers of `rev-parse --verify -q` decide a row: rc 0 with a 40-hex sha qualifies, and rc 1 does not. rc 1 is git's answer that the ref is not there: a missing ref, and also one git itself ignores as broken or cannot read (review 1143 F1). The probe takes git's answer, so such a row's old file is pruned, and wave 4 reads the absent file as `lineage-unmeasured`. Every other answer leaves the row undecided: rc None, a negative rc (a read a signal killed, the handler's own kill or a stop that signalled the child directly), 128 (an unreadable repository), rc 0 with an answer that is not 40 hex, or any other value. An undecided row keeps its old file on a measured base, and on a failed fetch or in the before-first-write fallback it is rewritten unmeasured with `tip: null`; it is never pruned | An unreadable answer is not an answer: in the fallback the checkpoint after the read is a no-op (`CLOSING`), so a read the signal killed was decided and its row's old file pruned (review 1140, F1). This also closes the deferred minor "`qualifying` prunes a row on rc 128" |
| held rows and an unlistable registry (fix round 4) | "On a failed or timed-out fetch, every qualifying row's lineage is rewritten", and "Stale files … removed each tick" | `project_rows` answers None when `$REG` cannot be listed, and the lineage pass then writes no lineage file and removes none, on every route: a measured base, a failed or cut fetch, a slug that is None and the before-first-write fallback (`lineage-skip: the registry could not be listed`; the fallback's re-read may say it twice in one tick). A registry field is read through `read_reg_field`, which tells ENOENT on the open from every other failure, so `reg_field` answers None (absent), the text, or an unreadable answer (an open or read error, a symlink, not a regular file, over 4096 bytes, not UTF-8, more than one line). A row whose `.project` cannot be read, or whose `.project` names the project beside a `.branch` that cannot be read, is held: it never reaches `measure` or `qualifying`, its id joins the prune's keep set, and its old file is neither rewritten nor removed, on any route (`lineage-skip: a registry row could not be read`). Since fix round 5 "held" also means "names no well-formed branch": a readable `.branch` that starts with `ws/` but is not `ws/` followed by a name `WS_NAME_RE` fullmatches (components of `[A-Za-z0-9._-]` joined by single slashes, with no `..`, no component that starts with `.` or ends with `.lock`, and no trailing `.`) is held the same way, and logs its own fixed line, `lineage-skip: a registry row names no well-formed branch` (review 1158 F2, F6). A NUL byte in such a `.branch` used to reach `subprocess.Popen` and stop the whole project's lineage pass, and `ws/alpha~0` reached `rev-parse` as a revision expression and was written with another object's tip. An absent `.branch`, and a readable branch outside `ws/` whatever its text, stay decided: no lineage, and the old file is removed. The before-first-write fallback and a slug that is None are pinned too (F5-b, F5-c), and every case that relies on a mode bit skips as uid 0 | The probe never narrows a distinction it received: an unlistable registry is not an empty one, and an unreadable field is not an absent one (review 1143 F5, F6). A held row has no branch to report, so it cannot get the unmeasured rewrite; it is held whole. Both fail closed: wave 4 reads an old file by its own `at`. The branch grammar is a second one beside ccd's `_ws_branch_valid`, and legitimately different: it is another language in another process (the probe's embedded Python, which cannot call a bash function), and it is deliberately narrower, a subset of git's own ref-name rules that still covers every name ccd can write (`ws/<slug>` at birth, and any `ws/` name `ccd ws-rename` lets through; checked against `git check-ref-format`). Its DWIM half is carried (review 1158 F6): a well-formed name the repository lacks can still answer rc 0 through a ref named `refs/heads/refs/heads/<branch>` or a tag named `refs/heads/<branch>`, which needs a pathological ref and fails closed, because the claim's live tip cannot be read; the remedy is rulings-1143 item 5's `show-ref --exists`, and wave 4's reader reads the live tip by the full ref name exactly |
| an unlistable registry and the probe record (fix round 5, carried) | `id` null "when no registry row matches", and the pairwise set is the bound heads | An unlistable registry gives `measure` no rows, so `probe` is written `measured` with every head's `id` null, `pairHeads` and `pairs` empty and `pairsCut` false. `id` null means no row names the head's branch, or more than one row does, or the registry could not be listed; the record does not say which. A head whose branch two rows name, one held and one readable, binds to the readable row, because held rows never reach `measure` | A known narrowing, carried rather than fixed in this wave (review 1158 F3): each head's base answer is a real measurement, and only its binding to a registry row is unknown; no shipped reader names `pairHeads` or `pairsCut`, and doctor reads the heads' answers, not `id` or `pairs`; a new `why` word would reopen the probe's settled format (R7). Carried to waves 4 and 4b, whose readers are the first to read `id` and `pairs`: before trusting a null `id`, they read the registry state themselves or add a marker to the probe |
| `git_check`'s read of the forms table (fix round 3) | The forms table read with `OPTION_FORMS.get((where, sub), ())` | `OPTION_FORMS[(where, sub)] if (where, sub) in OPTION_FORMS else ()`. The verdict is the same for every element: the key is always a hashable `(str, str)` (`where` is an `ALLOW` key and every argument a `str`), every `ALLOW` pair has an entry, and the refusals after it are untouched | R5b's census admits no method call on the table, a read included (review 1140 A2; accepted by review 1143) |
| R8's allowance of the plan file (fix round 3) | Review 1140 A3: the only holders of the two test-only variables are the probe, the tests and the wave's notes | `CCD_LAND_PROBE_SELFTEST` may also be held by the plan file, and nothing else outside that set; `CCD_LAND_PROBE_SELFSIGNAL` is held to the set alone. Each arm asserts that the probe itself holds its variable (the `SELFTEST` one restored in fix round 4) | The plan names the self-test knob among its deviations, and the plan file may not be edited. The ruled set is applied unchanged to the self-signal variable, which is what A3 was about (accepted by review 1143) |
| renamed case (fix round 1) | The plan names the case "the project repository is not written, and no hook or fsmonitor runs" | The case is "the project repository is not written, and no hook runs (the fsmonitor setting is held by the prefix pin)" | The fsmonitor half is held by R5's pin of the git prefix, which a mutation that drops `core.fsmonitor=false` turns red (review 1125, A8) |
| lstat of `$REG/landing/` (fix round 1) | The Design: every directory deleted from is lstat-checked and owned | `remove_own` checks `$REG/landing/` itself as well as the project directory, and so does the pause read | A symlinked `landing` directory let an `enabled` file in its target be deleted (review 1109, A4) |
| env | Child env per the plan | The child env adds `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1` and `GIT_CEILING_DIRECTORIES`, as ccd's own read env does | A lazy fetch or a replace ref could otherwise change what a read-only measurement reads. |
| doctor | `_check_land-probe` per the plan | Doctor also SKIPs a project whose per-project `paused` file stands | It mirrors the probe, which writes nothing for a paused project. |
| mutations | The brief names `mutation-run.py` | A sequential driver: save a copy (sha checked), apply the edit once, run the named vitest files under `timeout -k` and a measured `ulimit -u`, restore from the copy (sha checked) | `mutation-run.py` loads a Python module and Python test functions. The probe is a bash file run by vitest suites. |

## Accepted by ruling, no code change (review 1109)

- **F3, the alternate refreshes object mtimes.** Git freshens an object already in the project (its loose file's or
  pack's mtime) instead of writing a copy. No content, ref, config, hook or object set changes, and every object it
  touches is one the project already holds. The probe's header, README and the not-written test's comment say
  exactly this, and the alternate stays. The ruling's sentence said "reachable from the workspace branch". That holds
  for the lineage walk only: a merge-tree of the base against a head, or of a pair of heads, can freshen any object
  the project holds. So the wording is "one the project already holds" (fix round 1 review, N4).
- **Departure 3 (R7).** A null `store.after` and a null `scratch.sizeKiB`, for an interrupted tick or a failed count,
  are inside the `probe` grammar; a reader treats null as unmeasured.
- **A10.** Doctor PASSes a `main-health` that reads `pending` or `no-required-set` and names it on the line; every
  other unmeasured why WARNs.

## Accepted by ruling (review 1125)

- **Departure 1, the other halves.** The git door's prefix rule still runs first, and `--` is admitted for the fetch
  alone. (The third half, the check stopping after `--`, was reversed: every dash-led element after it is refused.)
- **Departure 2.** The child unblocks SIGTERM and SIGINT in `preexec_fn`, after resetting both to their defaults.
- **Departure 3.** `tip: null` for a row whose local read the budget left undecided on a failed fetch. Wave 4's reader
  reads an unmeasured doc's null `tip`, `base` and `stop` as absent, and answers `lineage-unmeasured` with the fixed
  detail `tip-unmeasured`.
- **Departure 4.** `fetch-failed` for a failure before the first write. The probe's set has no closer word; README
  says so.
- **Departure 5.** The probe header's step list, with the real order of step 4: the open heads are read, then the
  scratch is made and the fetch runs.
- **Departure 6.** The wording "an object the project already holds" replaces the ruled "reachable from the workspace
  branch", because it is the accurate one.
- **Departure 7.** `gh pr list` stays. It is a GraphQL query, which `gh` sends as a POST, and it is a read; README
  says so.
- **N6.** A wave 4 question: wave 4's reader bounds the lineage doc's freshness by the doc's own `at`. Nothing changes
  here.
- **Carried to the ledger.** A project that the tick budget leaves unstarted in sorted order, tick after tick. Wave
  4's freshness bound makes it fail safe.
- **The review's refuted items.** No action.

## Accepted by ruling (review 1140)

- **F2, an interrupted tick reads as a running one.** By R7 an interrupted tick's probe has the interim record's shape
  (`store.after` and `scratch.sizeKiB` null), so doctor reads it as a tick still running until the next tick rewrites
  the trio. The verdict switches at checkpoints, not at writes (review 1158 F4). Its PASS line carries the previous tick's
  main-health verdict when the signal was recorded before `read_checks`' last forge checkpoint, and this tick's when it
  was recorded after that checkpoint and before `finish_probe`'s nulling test (review 1143 A1): a signal recorded after
  the last forge checkpoint but before this tick's main-health write still leaves this tick's verdict, beside a `probe`
  with the interim figures. A signal recorded before the last checkpoint ahead of the tick's first `probe` write leaves
  the previous complete record; when there are zero open PRs, or the PR list failed, no checkpoint runs between the
  base rev-parse and that write, so a signal recorded after the base rev-parse's checkpoint leaves this tick's `probe`
  with the interim figures. One recorded after the nulling test leaves the measured record whole, as `finish_probe`'s
  docstring says. That is also what doctor shows during
  every running tick, bounded by the next tick and by the stale arm. The doctor check's header says so. Carried, not
  this wave's: if a later reader must tell an interrupted tick from a running one, an explicit marker is that wave's
  to add.
- **A5, the two exit-status edges.** Each needs two signals, and both are reasoned, not reproduced: CPython's
  finalisation after a recorded SIGTERM (a late SIGINT could end the process with 130), and `exit_status` reading
  SIGTERM first when both are pending.
- **A6 (1).** `shutil.rmtree` can remove the sentinel before the rest; if the removal then fails or is SIGKILLed, the
  remnant has no sentinel and the stale sweep never clears it. It joins the deferred minor on a SIGKILLed tick's
  leftovers, with its remedy named: remove the sentinel last.
- **A6 (2).** A `log()` that raises inside the closing path's `except` skips the kill and the removal. The sentinel is
  intact, so the stale sweep clears the scratch an hour later.
- **Fix round 2's departures 1 to 10**, each as the review evidenced it: (1) one journal line changes, `the closing probe
  rewrite stopped (SystemExit)`; (2) the closing path's own mask is dropped; (3) `CLOSING` makes the fallback's shared
  checkpoint a no-op; (4) an exception after a recorded signal is an interrupted tick, with no fallback; (5) a signal
  during the fallback leaves each row by when it was read: a row read after the signal is undecided, and with an old
  file it is rewritten with `tip: null` (true for a killed read too since fix round 3); a row read before it with rc 0
  and 40 hex qualifies and is rewritten unmeasured with the tip it read, even with no old file, and so is a read that
  exited 0 but was not yet reaped when the handler ran; a row answered rc 1 before it is decided, and its old file is
  pruned; held rows, and every row when the registry cannot be listed, are untouched (review 1143 F2);
  (6) the test mechanics (`write_json` binds `tmp` one statement after `mkstemp`, the killpg case's first signal comes
  from the fetch's git wrapper, the except-log case uses `runPatched`); (7) the AST census also refuses `__builtins__`,
  `__import__` and `__builtins__` as attributes, and a duplicate import; (8) a second `--` after the fetch's `--` is
  `option --`; (9) `on_signal` skips a reaped child, a guard no case can see; (10) a signal after `exit_status` has
  read the pending set is dropped at exit, once the tick has finished.
- **FR2-C3-9, an equivalent mutant.** The handler kills through its local, `run_child` clears `CHILD`, and FR2-1-8 and
  FR2-C3-8 hold the kill.
- **The review's refuted items.** No action.

## Accepted by ruling (review 1143)

- **F1, rc 1 is git's "not there".** `rev-parse --verify -q` answers rc 1, with nothing on stdout, for a missing ref and
  also for one git ignores as broken or cannot read (a loose ref holding garbage or at mode 000, an unreadable
  `refs/heads/ws` directory, a dangling symref, an unreadable reftable); `for-each-ref` does not tell them apart
  either. Git gives no distinction through the door, so this is not a narrowing: the row is decided, its old file is
  pruned, and wave 4 reads the absent file as `lineage-unmeasured`. `qualifying`'s docstring and the "undecided rows"
  row say so. Carried, not this wave's, with its remedy: `git show-ref --exists refs/heads/<branch>` (git 2.43 or later)
  tells the cases apart (measured on git 2.53: 2 for a missing ref, 1 for a garbage or mode-000 loose ref, 0 for a
  dangling symref). Adopting it adds a verb to the read-only door, so it is a later wave's decision.
- **F2, wording only.** The "exit paths" row and fix round 2's departure (5) say what the fallback does to each row by
  when it was read.
- **A2.** The killpg case's time bound holds the handler's kill; test (a) cannot tell it from the read's deadline, and
  need not.
- **A5.** Covered by F4: R5b's census pins every node that names `OPTION_FORMS`.
- **A6, wording.** On a failed or cut fetch, or a slug that is None, `CLOSING` is false, so a signal recorded before
  the last ws/ row's read checkpoint in `write_failed`'s lineage pass raises at `qualifying`'s checkpoint, past
  `guarded_lineage`, before `write_failed` returns: `first` is never set, `finish_probe` does not run, `probe` keeps
  `write_failed`'s first record (the interim shape: `store.after` and `scratch.sizeKiB` null), and the old lineage files
  stand until the next tick. Corrected by review 1158 F4: the files are left as they were only for a signal recorded
  before the last read checkpoint the route passes through. A signal recorded after `qualifying` has returned raises
  nowhere in the pass, so the rewrite and the prune finish (and so does the pass when no row reaches a git read); on a
  measured base, rows rewritten before a later row's walk checkpoint raises stay rewritten; in the before-first-write
  fallback no checkpoint raises (`CLOSING`), so this exception never applies there (the "exit paths" row says what the
  fallback does). `probe` and `main-health` are this tick's by the time the lineage pass runs, on every route; a signal
  at the fetch's own checkpoint, before any write, leaves the old ones standing and runs no fallback. `lineage_pass`'s
  and `finish_probe`'s docstrings say so. Nothing to pin: the next tick rewrites them.
- **Fix round 3's departures.** (1) and (2) as the review evidenced them (the two rows above); (3) reworded by F1; (4)
  accepted with A2.
- **The review's refuted items.** No action.

## Accepted by ruling (review 1158)

- **Fix round 4's departures 1 to 8**, each as the review evidenced it: (1) `project_rows` answers `Rows(rows, held)` or
  None, so the ruling's `rows or []` is spelled `listing.rows if listing is not None else []` (a namedtuple is always
  truthy); (2) the M-F5 mutation is spelled `return Rows([], set())`, because a bare `[]` would raise at `listing.rows`;
  (3) `read_reg_field` answers bytes, None or `UNREADABLE`, and `reg_field` alone applies the size, UTF-8 and one-line
  rules, with `read_small` and `parse_conf` unchanged; (4) the census counts more node kinds than the ruling listed and
  records the scope chain and the Assign's target count, and it stays stricter than the ruling; (5) R8b, a unit case of
  the holder scan, is added beyond the scratch measurement; (6) F6 checks "no line names the id" for the held row only,
  because the other row's own `unmeasured <project> <id>.lineage fetch-failed` line names its id, by design; (7)
  README's "For a kept file, stage 4 compares its tip…" sentence regained its referent; (8) the PR body corrections.
- **F3, carried.** An unlistable registry gives `measure` no rows, so `probe` is `measured` with every `id` null; the
  "an unlistable registry and the probe record" row above says so, and what wave 4 and 4b must do before trusting a null
  `id`. A head whose branch a held row and a readable row both name binds to the readable row.
- **F6, its DWIM half, carried.** A well-formed but missing branch can still resolve through a pathological ref; the
  "held rows" row above says so, with its remedy and wave 4's reader rule.
- **F7** (`holdersIn` and a tracked path that is not a regular file): refuted by its refuter, no action. No such path is
  tracked, and the docstring names the symlink case.
- **The review's refuted items.** No action.

## Absorbing main, and doctor's cadence

PR #1740's light run went red on `census-w8/cadence` and `single-definition/kernel-tail-cadence`. These run main's
D-7054 census, which landed after this branch's base: no doctor line restates a timer's period. Main passed both
files on a clean checkout, so the branch absorbed main once, by `git merge` (worker clause 16, trigger 2).

`_check_land-probe` now reads `ccd-land-probe.timer`'s period through `_dr_cycles_s`, as the scope-sweep and
pool-sync checks do:
- The stale default is four periods. `CCRC_LAND_PROBE_STALE_S` stays as the override.
- The not-yet window is two periods.
- The sentences name the period that was read.

A period that cannot be read drops the bound or clause that needed it. Doctor then warns, naming the unit, and never
falls back to a literal.

## Mutation outcomes that differ from the plan's prediction

- **M21** (the stale-scratch sweep without its uid and symlink checks) first measured green. `shutil.rmtree` refuses a
  symlink itself, and `ignore_errors` hides that refusal. The scratch case now pins that exactly one stale scratch is
  reported cleared, so the lstat check is what decides, and M21 measures red. The uid half still cannot be pinned with
  one uid.
- **M20**'s second layer alone (`write_json`'s `real_dir`) stays green, because `ensure_dir` refuses first. M20 as
  the plan wrote it, both layers together, is red.

## Acknowledged, no change

- **Parser differential (security hook, MEDIUM).** The repository slug is read from `remote.origin.url`, but the fetch
  uses `ls-remote --get-url`, after any `insteadOf` rewrite. The PR heads are measured by the `headRefOid` shas gh
  returns, so a re-pointed URL cannot substitute a head. Only the base sha follows the URL, and the box's own user
  writes that config.
- **`pending` in main-health** lists every name not yet proven: pending, app-unverifiable and app-conflict names. Read
  it as "not yet proven", not as `why == pending`.
- **Lineage cut by budget.** A walk cut by the budget before its first step is rewritten `unmeasured` with an empty
  chain, so a chain proven on an earlier tick is not shown until the next tick. Stage 4 reads that as
  `lineage-unmeasured`, which fails safe.
- **Freshness for wave 4.** Since fix round 1 `enabled` is written by the pre-pass at the start of each tick, so two
  writes of it are one tick apart however the projects are ordered or spend their budgets. A tick that dies before its
  pre-pass writes nothing, and the file ages out.

## Residual minors after the fix wave's re-review

- If a project's first tick ever raises after its first `probe` write and before `main-health`, doctor reads
  `land-probe-unreadable`, and its remedy says to start the service, not to read the journal. A pinned test holds
  that word.
- The doctor contract test's case C5 waits 1.1 s to get a distinct `at` second.

## Deferred minors (left by the final review's triage)

- A `.lp.*` temp file or a scratch with no sentinel, left by a tick that was SIGKILLed (never by a SIGTERM or SIGINT
  since fix round 2), is never swept. So is a remnant whose sentinel `rmtree` removed before a removal that then failed
  or was SIGKILLed (review 1140, A6 (1)). The remedy: remove the sentinel last.
- The uid half of M21 cannot be pinned without a second uid.
- A branch with two registry rows gets `id: null`.
- The combined status is read as one page (`/status`, without `per_page`).
