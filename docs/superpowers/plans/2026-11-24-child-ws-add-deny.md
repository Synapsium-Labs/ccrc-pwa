# A dispatched child never runs `ccd ws-add`

**Goal.** Close the gap where a dispatched worker (a session whose row carries `$REG/<id>.child`) runs `ccd ws-add`
itself and makes a workspace outside every run. Such a workspace has no `--child` and no run row names it, so the console
lists it under "Not in a programme" and its coordinator never sees it. Measured on a live fleet: 1 of 1215 workspace
creates in the lifecycle journal was this shape (actor `run:<id>`, surface `none`, no `--child`).

## The choice: deny it for children (option a)

Two options were put forward:

- **(a) Deny it for children**, in the layers the existing child denies use.
- **(b) Have `cmd_ws_add` stamp the creating child's run onto the new row**, so it groups under that programme.

**(a) is built. (b) is rejected.** The reasons, against CLAUDE.md's rules:

1. **One writer per fact.** Which run a workspace belongs to is the server's fact. A run row's `sessionId` and claim are
   written by the dispatch on the coordination serialiser, and `.child` is written only by `ws-add --child <run>` that
   the server composed. Under (b), `ccd` would infer a run from the caller's environment and record it, which makes a
   second writer of the run-to-workspace link, one the server never decided. The dead-dispatch pass, the reclaim lanes
   and the run's cap would then meet a marked child that no dispatch minted.
2. **Zero new ccd verbs for coordination mutation.** (b) adds no verb, but it turns `ws-add` into a coordination write
   whose input is whatever the calling shell carries. (a) adds no verb and no write.
3. **Scope.** A worker that makes a workspace has left its brief: the coordinator planned one tree for it. Grouping the
   tree under the programme (b) would hide the escape rather than stop it. A worker that needs another tree asks its
   coordinator, which can open a run for it.
4. **`ccd` is the only component that names tmux and systemd.** Neither option touches that boundary, but (b) would have
   `ccd` reason about runs, which is the server's model. (a) keeps the decision on the session's side, in the hook and
   the deny file, which already decide what a child may run.

## What was built

| Layer | Where | What |
|---|---|---|
| The deny list | `shared/api.ts#childDenyRules`, `CHILD_SCOPE_DENY_CCD_VERBS` | A second verb list, child-only, holding `ws-add`. `childDenyRules` emits `Bash(ccd ws-add:*)` after the SAFETY verbs. `FORBIDDEN_CCD_VERBS` and the classifier are untouched, because `ws-add` is not a SAFETY verb: the operator, a top-level session and the server still run it. |
| The deny file | `ccd/install-session-hooks.sh#_child_deny_json` | The bash twin's loop gains the same list, so `~/.cc-sessions/child-deny.settings.json` names the rule. `install-session-hooks.test.ts` holds the file equal to `CHILD_DENY_RULES` by iteration. Adding the rule changes the file's sha256, and that costs something at rollout: a child spawned before it keeps the older digest until it respawns, so `server/src/coord/approvalDenyFloor.ts#denyStandingOf` reads it as `history`, its approvals are routed and held as `denyCurrent` false, and `approvalAllowRefusal` answers `deny-not-current` to every coordinator allow for that child (a coordinator may still deny or hand over). Every child running at rollout pays it once, until its next spawn. |
| The hook | `ccd/session-hook.sh`, `CCD_WSADD_RE` and THE CHILD'S WORKSPACE DENY | `CCD_WSADD_RE` is the worker merge deny's head grammar, cut where `CCD_DOOR_RE` is (D-8124's precedent). It is asked of the merge arm's stripped text, so quoted text, comments and heredocs that name `ccd ws-add` pass. The strip wakes for `ws-add` only in a child (`wchild`). The question is asked only when the merge questions set no deny. |

**Why the merge arm's strip and not the child arm's `fmatch`.** The child's forbidden-verb arm reads the command as bash
runs it with quotes removed (`norm`), so it refuses a mention: `grep -n "ccd ws-add" ccd/ccd` or
`git commit -m "fix ccd ws-add"`. ccrc's own workers write those all the time, because `ws-add` is one of the most-cited
verbs in this tree. The merge arm's strip drops quoted spans, comments and heredoc bodies before matching at a command
head. That is the precision this deny needs, and `ccd pr-admin-merge` (D-8124) already rides it. No new parser is added:
this extends the existing owner of quote stripping.

**The server's dispatch is never refused.** `dispatch.ts` composes `ws-add --no-rc --child <run> …` as a `CcdArgv` exec
through the agent link. That is not a session's tool call, so neither the hook nor Claude Code's deny matcher sees it.
The corpus holds that argv among the spellings a child is refused when it types them itself. The test also pins that a
session with no marker (top-level, or held but unmarked) passes every spelling.

## Tests

- `server/test/session-hook-ws-add-deny.test.ts` runs the real hook in a fixture HOME and iterates
  `server/test/fixtures/ws-add-deny/must-deny.json` (25 spellings, the server's argv and a fixture-`HOME` path-spelled run included) and `must-allow.json` (17
  mentions and other verbs). It also covers: a dangling marker link, sessions with no marker, the merge deny kept, the
  listed passes, `CCD_WSADD_RE` derived from `GH_MERGE_RE`'s head, the deny file rule, and the prefilter's budget.
- `server/test/ccd-spawn-child-settings.test.ts`: the rule list gains `Bash(ccd ws-add:*)`, and `FORBIDDEN_CCD_VERBS`
  never names `ws-add`.

**Mutants, each measured red against the new suite and green restored:**

| Mutant | Result |
|---|---|
| M1: drop the hook's deny assignment | 25 failed |
| M2: ask every session, not only a child | 2 failed |
| M3: wake the strip for `ws-add` in every session | 1 failed (the budget) |
| M4: a dangling marker link no longer counts | 1 failed |
| M5: replace a merge deny already set | 1 failed |
| M6: drop the prefilter term | 26 failed |
| M7: empty `CHILD_SCOPE_DENY_CCD_VERBS` | 9 failed across three files |
| M8: empty the installer's loop | 4 failed in `install-session-hooks.test.ts` |

## Deviations found

- **D-8978 (2026-11-24)**: a dispatched child never runs `ccd ws-add`. Option (a) is built: a child-only verb list in
  `shared/api.ts` (`CHILD_SCOPE_DENY_CCD_VERBS`, emitted by `childDenyRules` as `Bash(ccd ws-add:*)`), the installer's
  twin loop, and the hook's `CCD_WSADD_RE`, asked of the worker merge deny's stripped text in a child only. Option (b),
  stamping the creating child's run onto the new row in `cmd_ws_add`, is rejected: the run-to-workspace link is the
  server's fact, and (b) would make `ccd` a second writer of it from the caller's environment. `ws-add` stays off
  `FORBIDDEN_CCD_VERBS` and CLAUDE.md's SAFETY list, because it is not forbidden to every session. The classifier is
  unchanged: a child runs with permissions bypassed and raises no prompt for it.
- **D-8979 (2026-11-24)**: the child's workspace deny is an accident guard, not a wall. It passes, unparsed, every form
  the merge head grammar passes: `bash -c "…"`, a quoted or variable command word (`C=ccd; $C ws-add`), a quoted verb
  (`ccd 'ws-add'`), `xargs`, `eval`, an unlisted or path-spelled wrapper, and a leading redirection. It also passes a
  command over `MERGE_PARSE_CAP`, a verb split so that the payload holds no `ws-add` (`ws\-add`), a script file and
  another interpreter. The deny file stops the plain forms at Claude Code's own matcher as well. The marker asks the
  question, never the hold, so a held session without a marker (a top-level session that a coordinator bound to a later
  wave by `sessionId`) is not asked. A worker can still make a tree with plain `git worktree add`, which no registry row
  names; that is out of this change's scope. Identity on the box is attribution, so a session determined to make a
  workspace can still do it. The measured case was an accident, and the guard is sized for that. It also refuses what it should not: the hook cannot tell a fixture `HOME` from the live one, so a child's `HOME=<fixture> ./ccd/ccd ws-add …` is refused too (pinned in `must-deny.json`). A ccrc worker exercises `ws-add` through the test harness (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`), which spawns `ccd` from inside vitest, so the hook sees only the test command and never refuses it. Adding the rule also changes the child deny file's digest, so each child running at rollout has its coordinator allows refused `deny-not-current` until it respawns (the deny file row above).
