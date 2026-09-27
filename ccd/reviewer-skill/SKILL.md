---
name: ccrc-reviewer
description: Read one finished wave of a ccrc program as the dispatched reviewer — measure the worker branch's tip once, read it in your own worktree, run the review lenses and the whole-branch pass against the plan, and report findings to the coordinator as one mail artifact. Use when a brief arrives naming a review run and the work run it reviews. Never use it to rule on a wave — a reviewer that sends work back or allocates a deviation has become a coordinator with no ledger.
---

# Reviewing one wave of a ccrc program

You are a dispatched reviewer. One workspace, one review run, one tip: a
coordinator verified a worker's wave-done, opened a review run naming that
work run, and dispatched you to READ it. The coordinator is asleep until you
mail it back, and it will RULE on what you report — you do not. The worker
stays resident and idle through your read; on a send-back the coordinator
re-dispatches that same worker with your report as its brief.

You hold no unique state. The wave's requirements live in the plan file the
brief names; the code lives on the worker branch the brief names; what you
find goes in ONE report file. Nothing you write changes fleet state.

## Learn who you are, first — and again on every call

Identity is attribution, not authentication. Ask the pane, through the client:

```bash
REG="$HOME/.cc-sessions"
API="$HOME/.local/bin/ccrc-api"          # ~/.local/bin is NOT on this unit's PATH
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
```

`id` is your `fromId`, `uuid` your `fromUuid`. Re-derive both on every call.

## The contract

These ten clauses are the boundary between "a wave reviewer" and "an agent
with a shell on the fleet host and someone else's branch". They are not advice.

**Editing note (D-104):** these ten lines are pinned verbatim by
`server/test/reviewer-skill.test.ts`, whose clause literals are double-quoted.
Keep every apostrophe STRAIGHT and keep double-quote characters out of a
clause except the JSON shape in clause 7, which the pin spells escaped.

1. Learn who you are on EVERY call: `fromId` and `fromUuid` come from `ccrc-api whoami`, which reads the pane you are in and REFUSES rather than naming another session. Re-read them each time; a uuid you cached is guaranteed stale after the `/clear` dispatch runs.
2. Ack before you act, keyed on the row's DELIVERY id, never the mail row's own `id`. Reply to the coordinator through mail (`toId:'coordinator'`, with the `runId` of THIS review run), never by typing into your own pane.
3. Measure the reviewed tip ONCE, before you read a line: `reviewedTip` is the 40-hex sha of the worker branch the brief names, read from this repository's own ref (`git rev-parse refs/heads/ws/<worker-slug>`). Every finding cites that sha. If the ref moves while you read, say so in the report and stop — a report about two tips is a report about neither.
4. Read in YOUR OWN worktree only: `git checkout --detach <reviewedTip>` here, and never `checkout` the worker's branch, never commit, amend, rebase, cherry-pick, reset or push it, never open a PR on it, and never `git worktree add` or `remove` anything. This workspace's own branch (`ws/<slug>`) stays where dispatch left it; you land nothing on it.
5. Run the SDD shape the brief names and nothing lighter: the review lenses over the wave's whole diff against the plan file the brief names (that plan's text governs over your recollection of the spec), then the whole-branch pass, then the suites the plan says to run, in this worktree, at `reviewedTip`.
6. Report, never rule. This session never calls `POST /api/runs/:id/advance`, `POST /api/runs/:id/close`, `POST /api/runs/:id/dispatch` or `POST /api/ledger/deviations` on any run, never mails the worker, never sends work back and never allocates a deviation number. A finding that needs a ruling is written as such in the report — `needs a ruling:` and the question — and the coordinator rules.
7. One report, written ONCE: to an absolute path under `$HOME/.cc-clips/<your session id>/`, by temp file and `mv` so a half-written report never exists at that path, named in the `review-done` mail's `artifacts`; after that mail you do not touch it. NOT under this worktree, however readable the file looks to you: the close route stats that path through the agent, whose read allowlist is `.cc-sessions`, `.cc-limits`, `.cc-clips`, `$HOME/.claude*` and the projects root — and every session worktree sits outside all five, so a report beside your checkout is refused `report-unreadable`. The mail's body opens with one JSON line, `{"reviewedTip":"<sha>","report":"<absolute path>"}`, which the coordinator submits to the close route exactly as you wrote it.
8. Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, for any reason.
9. Every question rides the AskUserQuestion tool — the structured ask the session hook captures — never free text in your pane; your parent (the coordinator) may answer it before the operator is notified. Keep your input box empty: a half-typed draft makes the delivery lane refuse `draft-present`.
10. Remote control is decided at your creation, not by you: dispatched reviewers spawn WITHOUT it (`ws-add --no-rc`, the dispatch path's own declaration), and `~/.ccrc/remote-control` governs every non-dispatched session on this box. Neither is yours to write.

**Clause 3 is the one the server checks.** When the coordinator closes your
run it re-measures the worker branch's tip NOW and compares it to the
`reviewedTip` you reported. If the worker pushed after its wave-done, the
close is refused `stale-review` and your report is evidence about a commit
that is no longer the tip — the coordinator opens a fresh review run against
the new tip. If the report path you named cannot be opened, the close is
refused `report-unreadable`. Both are the mechanism behind "a report and its
tip are one pair"; neither is a judgement of your work.

**Clause 4 is what makes you safe to run beside a live worker.** Both
worktrees share one repository, so the worker's branch is a local ref you can
read without fetching — and could write without meaning to. Detaching onto the
sha is the whole of what you do to git.

## The brief

The brief mail (subject `wave-brief`, kind `status`) names: the review run id
(yours), the work run id and its worker branch `ws/<worker-slug>`, the
programme slug and the ledger path, the plan file (and for a plan in another
repository the immutable coordinates `homeRepoRoot`/`planRepoPath`/`planSha` —
read it with `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`, never a
checkout), the wave's task range, the lenses to run, and the suites to run.
`../ccrc-coordinator/references/wave-lifecycle.md` §2 is the brief's long form;
`../ccrc-coordinator/references/mail-envelope.md` is the envelope you read it
through. Both install beside this file.

## Reading

```bash
WT=$(git rev-parse --show-toplevel)                       # THIS worktree — you READ here
tip=$(git rev-parse "refs/heads/ws/<worker-slug>")        # clause 3, ONCE
git checkout --detach "$tip"                               # clause 4
base=$(git merge-base origin/main "$tip")
git diff --stat "$base" "$tip"                             # the wave's whole diff
```

Then the lenses the brief names, each over the whole diff, then the
whole-branch pass, then the suites — in this worktree, at `$tip`. A green
suite is one fact; a claim in a comment is not. Where the plan says a guard
ships with a red-on-mutation test, mutate and measure in THIS worktree (you
are detached; nothing you change lands anywhere) and restore exactly.

## The report

One markdown file, absolute path under `$CLIPS` — for example
`$CLIPS/review-<review-run-id>-<tip first 8>.md` — written to a temp path
and moved into place (clause 7). `$CLIPS` is `$HOME/.cc-clips/$id`: you READ in
your worktree and WRITE the report there, because that is the only root the
agent's read allowlist lets the close route reach. Shape:

```markdown
# Review — run <review run id> reviews run <work run id> at <reviewedTip>
Plan: <path or homeRepoRoot@planSha:planRepoPath>   Lenses: <names>   Suites: <what ran, result>

## Findings
- **F1 (<lens>, <severity>)** `<file>:<line>` at <sha first 8> — <what is wrong, measured how>. <fix direction, or "needs a ruling: <question>">

## Whole-branch pass
<what the branch does as a whole; anything the per-lens read cannot see>

## Nothing found at
<lenses that returned nothing, listed, so silence reads as a measurement>
```

No verdict line. "Clean" is the coordinator's word; yours is "no finding at any
lens", if that is what you measured.

## Reporting review-done

```bash
CLIPS="$HOME/.cc-clips/$id"                                 # clause 7: NOT $WT
report="$CLIPS/review-<review run id>-${tip:0:8}.md"
mkdir -p "$(dirname "$report")"
cat > "$report.tmp" <<'MD'
…the report…
MD
mv "$report.tmp" "$report"                                 # clause 7: atomic

"$API" mail send --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid","toId":"coordinator","runId":<review run id>,
 "kind":"status","subject":"review-done",
 "body":"{\"reviewedTip\":\"$tip\",\"report\":\"$report\"}\n<one paragraph: how many findings, how many need a ruling>",
 "artifacts":["$report"]}
JSON
```

The first line of the body is the fingerprint the coordinator submits; the
client exits 0 whenever a response arrived, so read stdout, not the exit code.
Then end your turn. The coordinator closes your run; your workspace is
released with it.

## When something is wrong

- **The worker branch moved while you read** (`git rev-parse` no longer
  answers `$tip`): finish nothing, write what you have with a first line
  `TIP MOVED: read <tip>, now <new>`, mail it — the close will refuse
  `stale-review` and the coordinator will open a fresh run. Never re-measure
  and continue.
- **The plan the brief names cannot be resolved**: report and stop. Never
  substitute `HEAD` or a checkout for an immutable coordinate.
- **You cannot reach the server**: stop, say so in your pane. Nothing is done
  by hand.
