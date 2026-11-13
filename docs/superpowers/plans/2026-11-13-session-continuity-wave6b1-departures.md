# Session continuity wave 6b-1: four departures from its plan, recorded

The plan, `2026-11-12-session-continuity-wave6b-launch-record-and-manifest.md`, defines D-8361 to D-8380. Its first run,
6b-1 (Task 1, the launch record), shipped in #2723 (merged 2026-11-13 as `d8c4ed4a`). Its worker named one departure by
slug, and its first review (1875) found three more in the plan's wording. The coordinator allocated D-8400 to D-8403 on
2026-11-13 at 11:20 UTC, at acceptance, and defines them here. The findings fixed in the two fix rounds take no number:
the coverage gaps of reviews 1875 (F1) and 1876 (F1 to F3), and review 1875's silent size read (F3). Review 1877 found
nothing needing a ruling.

Nothing reads `$REG/<id>.deleg` until 6b-2's manifest, so none of these changes what a session or the server sees.
The plan's sentences that each one corrects now point to it.

- **D-8400 (2026-11-13)** — `launch-record-hot-path-cost-note` (Task 1; review 1875 F4): the plan's timing costs say
  the hook reads `$REG/<id>.wrapper`, and makes the generation read without the spool directory, on a PostToolUse of
  Agent, Task, Workflow or SendMessage, and its Review Focus places those reads on that path alone. That holds only
  where the spool directory is absent. Where it exists, which is every ccd-spawned session, the hook compiles
  `DSP_DEFS` on every event the prefilter matches, as it did on `main` (whose prefilter lacked `"SendMessage"`). That
  compile is now longer, since it also defines the launch record's defs, and the wrapper read and the `lrec`
  evaluation run on each such event, Bash included. Review 1875 measured the whole change on a Bash PostToolUse: about
  14.3 ms before and 15.5 ms after (+1.2 to +1.5 ms, about 9 percent), with Read events unchanged. Two cheaper changes
  run before the prefilter: the generation read, now on every event of a session with a generation file, and the
  `.deleg` type tests, on every event of every session. Both are builtin tests with no fork, at noise level (+0.06 to
  +0.3 ms). The cost is bounded: every read is builtin, at most 65 characters, regular files only, with no new process
  and no loop. It is a recorded limit, not a defect; narrowing it (for example, reading the wrapper only under the
  nested PostToolUse case) would depart from Task 1's Files text.
- **D-8401 (2026-11-13)** — `launch-record-pair-two-writes` (Task 1; review 1875 F2, its plan half): the plan says each
  append is one `write(2)` (COORDINATOR note 4, Task 1's Interfaces, and D-8366). A path failure's two lines go out in
  one `printf '%s\n%s\n'`, which bash writes as two `write(2)` calls, one per line (measured with strace on bash 5.3.9;
  a one-line append is one call). Every line stays whole, since each line is its own `write(2)` on an `O_APPEND`
  descriptor, and the budget's both-or-neither check holds. But a kill between the two writes leaves a `drop` with
  `why:"path"` without its `script:null` row, and a concurrent append can land between them. 6b-2's reader must
  assume neither that the two lines are adjacent nor that both are present. Fix round 1 corrected the hook's own
  comment, which now reads "Every append is one write per line (a pair is two)".
- **D-8402 (2026-11-13)** — `launch-record-send-plain-name-row` (the plan's "What 6b can count of resume attempts";
  review 1875 F5): the plan says 6b cannot count "a SendMessage to a name rather than an agent id". The hook writes a
  `send` row for any `to` inside the id grammar, so a plain name such as `researcher` writes `agent:"researcher"`.
  Only a `to` outside the grammar writes nothing: one with any character but letters, digits, `_` and `-` (a space or
  brackets, for example), an empty one, one longer than 64 characters, or one that is not a string. The code matches
  Task 1's Interfaces and its test. A plain name's row joins no agent, and Task 2's manifest retires an unjoined send,
  so the count the plan describes is unchanged. Only the plan's sentence was wrong.
- **D-8403 (2026-11-13)** — `launch-record-fork-count-wording` (D-8366; review 1875 F6): D-8366 says the hook forks
  one `wc -c` for each row it writes, and for nothing else. As built:
  - the hook forks one `wc -c` per append, and only once `.deleg` exists: a path failure's pair is one append, and a
    session's first append forks none;
  - over budget, it also takes one subshell for the drop row's time (`_hook_epoch_ms`, and on bash older than 5 a
    `date` inside it), before the reserve check, so it is taken even when no drop row fits and nothing is written.

  The subshell is negligible: review 1875 measured it at about 126 µs.
