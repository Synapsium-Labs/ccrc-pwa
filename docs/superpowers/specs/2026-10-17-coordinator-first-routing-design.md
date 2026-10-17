# Coordinator-first routing — design

**Status:** rev 0 (2026-10-17), for review. **Plan:** `docs/superpowers/plans/2026-10-17-coordinator-first-routing.md`. Deviation numbers D-5289 to D-5302 are defined once, in the plan's §Deviations found; this document cites them.

**Builds on:** the ask pre-emption lane (`2026-09-09-ask-preemption-lane-design.md`, "the lane spec" below), the structured ask (`2026-07-26-ccrc-structured-ask-design.md`), and the capability-word gate of the working-state plan (`2026-10-16-working-state-and-interruptions-design.md` §6.1, D-5232's mechanism).

**Citations** are to `origin/main` `b6ce2eb8`, written `≈:` with a function or constant name beside each line hint. **[B]** marks a reading of an installed Claude Code 2.1.302 binary (read-only `strings`, nothing executed); **[L]** a live test on a development machine against 2.1.302; **[M]** a read-only measurement over the last 7 days of fleet data (shapes and counts only, no transcript text).

---

## 1. The problem

The operator, verbatim (2026-10-17):

> "There's also a separatae problem where sub-workspaces still ask ME questions rather than routing them via coordinator (thereby likely filtering most of the needed human interaction out when the coordinator has an answer)"

> "I also still get a bunch of allow operation confirm this is OK questions, which should be auto-resolved by coodrinator without having to ping me (or auto-denied if the coordinator belives this action is truly harmful)"

Two streams reach the operator that a coordinator could settle: children's questions (AskUserQuestion), and children's permission prompts ("allow this command?").

## 2. Measured [M]

### 2.1 Questions

Over 7 days, dispatched children raised 37 AskUserQuestions.

| Outcome | Count | Why |
|---|---|---|
| held, answered by the parent | 18 (49%) | median about 41 s from hold to ruling |
| never held: more than one question in the call | 6 | `askActions` returns null when `questions.length !== 1` (`server/src/askkey.ts` ≈:78) |
| never held: first-sighting race | 6 | the hold is tried only on the first-sighting edge, and the envelope arrived one tick after the menu painted (§5.2) |
| held, then the 120 s window lapsed while the parent was still working | 3 | the parent then answered 16 s to 4.5 min later and was refused `not-held` |
| held, then the parent declined | 3 | correct behaviour |
| held, then the dialog cleared | 1 | correct behaviour |

18 of 37 (49%) reached the operator; when the operator answers, the median wait is about 2.5 h. Separately, 14 of 36 question pushes carried only a scraped box-border glyph as their body (§9).

Workspaces the operator created in the PWA raised 49 more asks. They have no parent in today's model. By ruling (§3), that is correct: they are coordinators, and their own questions are the operator's.

### 2.2 Permission prompts

Over the same 7 days (6,256 transcripts), dispatched children raised 26 permission prompts that a human answered, in 12 sessions.

- All 26 were Bash; the operator answered every one "Yes" once. None "always", none "No".
- 25 of 26 came from subagents inside children already running with permissions bypassed; 1 from a main thread.
- The child waited a median of about 16.5 min (an upper bound: tool call to tool result); 14 waited over 10 min, 9 over 1 h, the longest 14.8 h.
- Shapes, over the 27 human-allowed Bash prompts fleet-wide: 18 delete through a shell variable (`rm -rf "$X"`), 21 contain `rm`, 15 `cd`, 3 a git write, none a network command; 13 are 1,000 characters or more.
- By the guardrails of §6.4, a coordinator would have allowed about 21, handed about 5 to the operator (3 git writes, 2 credential-path mentions) and denied none. This is an estimate from shapes, not a replayed ruling.
- Top-level sessions had 2 such prompts; coordinators had none.

Settings allow rules cannot help: every measured prompt was already in bypass mode (95,725 automatic mode-accepts on children), so what still prompts is Claude Code's safety checks, which allow rules do not cover.

### 2.3 Who is a coordinator today

There is no role marker. A session is a coordinator only as the `claimedBy` of an open run (`CoordStore.openCoordinatorIds`, `server/src/coord/store.ts` ≈:3353), and a child's parent is derived on every read (`parentOfSession` ≈:6886). Of 29 active non-child workspaces, 9 coordinated in the window and 18 were single-task workspaces. A workspace made with the PWA's "+" is created by a bare `ccd ws-add <project>` (`server.ts` ≈:2709, `CCD_ARGV.wsAdd` ≈:337) with no actor, surface or role, and is told nothing about a role.

## 3. Operator rulings (2026-10-17)

- **Routing:** only dispatched workspaces route their questions to a coordinator. "No, only dispatched ones, all workspaces I create manually should automatically be coordinators."
- **While a coordinator holds a child's question:** "Quiet 'with coordinator' (Recommended)". The child leaves Needs-you and shows a calm "with coordinator" state; it returns to Needs-you, and pushes, only if the coordinator hands it over or runs out of time.
- **Oversight:** "Daily digest (Recommended)". As today, plus one daily summary of what coordinators decided in the operator's name, so the operator can correct anything by mail.
- **Hold time:** "180 s, late answer wins". The operator is notified at 180 s, but a coordinator answer after that and before the operator's still counts, and the notification updates to say so.
- **Permission prompts** are resolved by the coordinator (the second quote in §1): allowed without a ping, or denied when the coordinator judges the action harmful.

**Coordinator calls already made:** fix the first-sighting race (D-5290); late answer wins, with an explicit `declined` terminal state for a parent's own release (D-5289); the worker and reviewer skills say "one single-select question per AskUserQuestion call", shipped agent first (D-5291), and the lane widens to whatever the operator's own answer route can answer (D-5293); the parent's mail states the deadline and the ready-to-run answer command (D-5294); the empty push body is fixed in this programme (D-5302).

## 4. The routing model

```
operator
  ├── manual session (created by the operator)      ── a COORDINATOR, the root of its tree
  │     ├── dispatched child (run.sessionId)         ── asks its parent first
  │     └── dispatched child                         ── asks its parent first
  └── manual session that never dispatches           ── a coordinator with no children
```

- **A root** is any session the operator created (PWA "+", the create-session sheet, the start-programme sheet) and any session no open run names as `sessionId`. Its own questions and permission prompts go to the operator, as today: `parentOfSession` answers null for it, and the self-claim guard (`parent !== r.id`, `watch.ts` ≈:7902) stays.
- **A child** is a session an open run names as `sessionId`. Its questions and permission prompts go to `parentOfSession(child)` first, and reach the operator only on a hand-over (`declined`), a lapse at 180 s, or a guardrail class the parent may not allow (§6.4).
- **Being a coordinator is not being a parent.** A parent exists only once a run exists. Marking a manual session as a coordinator (§8) changes what it is told, not what is routed to it; routing to it starts when it dispatches.
- **Nested coordinators** stay refused: `POST /api/runs` answers `409 claimant-is-a-worker` for a claimant that is itself a worker (`routes.ts` ≈:1473), and the reclaim heir rule matches. If that refusal is ever lifted, routing already nests, since `parentOfSession` is per session; escalation stays single-hop, so a grandchild's declined or lapsed ask goes to the operator, never up the chain. No change in this programme.
- **One rule for both streams.** A child's question and a child's permission prompt use the same parent, the same 180 s window, the same "late answer wins until the operator acts", the same quiet state and the same journal. They differ only in how the answer reaches the child: a question by keys in the pane (`answerAsk`, unchanged); a permission prompt by the child's own hook printing a decision (§6), never by keys.

## 5. Questions

### 5.1 Late answer wins; `declined` (D-5289)

Today the release sweep moves a lapsed row `held → released` (`releaseAsk`, store ≈:7238), and `takeAskForAnswer` takes only `held`, so a parent's answer after the lapse is refused `not-held` while the child's dialog is still up and the operator has not acted (3 of 37).

- `takeAskForAnswer` takes a row whose state is `held` **or `released`**, under the same `askAt` instance guard. `heldAskFor`, which the operator's route uses to take and settle the row, matches both too, so either principal's answer after a lapse goes through the row mutex and is recorded.
- A parent's explicit `POST /api/asks/:id/release` moves the row to a new terminal state, **`declined`**: the parent handed the question over and may not answer it later (`409 declined`). `AskState` gains `declined` in `ASK_STATE_MAP` (one home, `shared/api.ts` ≈:1897); an older server reads it as `unknown` through `isAskState`.
- The lapse keeps firing the operator's push at the deadline. A late parent answer replaces that notification under the same tag with "answered by <parent>"; the operator's answer, whenever it lands, closes the row and the parent's later attempt is refused `already-answered`.
- The race between a late parent answer and the operator's pane is the mutex's: `answering` is taken by one principal only, and `answerAsk` re-verifies the dialog before every key.

### 5.2 The first-sighting race (D-5290)

`tick()` sweeps hookstate before `detectDialogs` captures the panes one by one. If the menu paints after that tick's hookstate read, `actions` is null (`watch.ts` ≈:7804), the ask is pushed without actions at once, and the hold, decided only on the first-sighting edge, is never tried. The amendment branch (≈:7953) later re-raises with buttons but never tries the hold (6 of 37).

- The amendment branch, where actions have just become available for a latched actionless dialog, runs the same `parentOfSession`, self-claim and kill-switch checks as the first sighting and, when a parent exists, mints the row and mails the parent instead of re-raising to the operator. The actionless notification already sent is replaced (same tag) by a quiet "with coordinator" body.
- The first actionless raise is deferred for up to two ticks while hookstate is not yet `waiting`, so in the common case the race never shows. An approval dialog is unaffected: its hookstate is already `waiting` when the menu paints.

### 5.3 Multi-question asks (D-5291, D-5293)

- **D-5291, at the source:** worker clause 5 and reviewer clause 9 gain one sentence: ask one question per AskUserQuestion call, single-select, so your parent can rule it; split independent decisions into separate calls. Shipped agent first; the clause literals and their pinned counts change with it.
- **D-5293, in the lane:** the hold's eligibility is no longer its own predicate. It becomes exactly what the operator's own answer route can answer: one exported predicate (`answerableAsk`) that both `askActions` and `answerAsk`'s refusal read. Today that is one single-select question, so nothing changes on the day it lands. When the ask-sheet work in flight (own-words answers and multi-select, on the branches `fix/ask-sheet-submit` and `feat/ask-sheet-keys`) widens `answerAsk`, the lane widens with it, and the parent's answer route accepts the same body shape the operator's does (`{answers: [{optionIndexes} | {text}]}` per question). The parent never presses keys itself; the server does, through `answerAsk`, as today.

### 5.4 The parent's mail (D-5294)

`renderAskBrief` (`watch.ts` ≈:8316) states:
- the UTC deadline: "the operator is notified at hh:mm:ss UTC unless you answer or hand over; a later answer still counts until the operator acts";
- the ready-to-run commands, in the coordinator skill's own client form: `"$API" asks answer <id> --json -` with a heredoc carrying the exact body, and `"$API" asks release <id>`, rather than raw HTTP lines.

### 5.5 The window: 180 s (D-5295)

`ASK_GRACE_MS` becomes `180_000` (`server/src/askwindow.ts` ≈:37). Every derived bound (`ASK_HELD_CHIP_MAX_MS`) follows from it; nothing else spells the number. The approval window (§6) reads the same constant.

## 6. Permission prompts

### 6.1 How a prompt reaches the operator today

`session-hook.sh`'s PermissionRequest arm (≈:2920) writes `waiting` plus `{approval: {tool, summary}}` (summary at most 200 characters) and prints nothing. `detectDialogs` scrapes the pane and pushes; the hold is never tried (`askActions` returns null for approvals). The operator answers through `POST /api/sessions/:id/dialog` (`server.ts` ≈:2133, `answerDialog`), which walks the cursor and presses Enter in the pane, or at the terminal. Nothing records who answered.

### 6.2 Rejected: the coordinator answers the pane menu

Through `/dialog` the coordinator would need keystrokes in the child's pane; the dialog's id (`sha1(labels + title)`, `pane/dialog.ts` ≈:429) does not include the command, so a different prompt can be answered between capture and Enter; the summary is cut to 200 characters while 13 of 27 commands were longer than 1,000; a cursor mis-walk onto row 2 or 3 writes a permanent allow rule or switches the session to auto mode; a deny cannot carry a reason; and nothing records who answered.

### 6.3 The mechanism: the child's own hook waits for a ruling (D-5297, D-5298)

Claude Code's PermissionRequest hook may print `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}` or `{… "decision": {"behavior": "deny", "message": "…"}}` [B]. Measured [L]: the permission menu stays on screen while the hook waits, so the operator can still answer as today; a hook allow dismisses the menu and the transcript records the decision's source as `hook`; an operator answer on the pane wins and Claude Code kills the waiting hook.

**Correction to the investigation.** The PermissionRequest hook input carries `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id` and `agent_type` (in a subagent), `hook_event_name`, `tool_name`, `tool_input`, `permission_suggestions` and `mcp_server`, and **no `tool_use_id`** [B: the input schema beside PreToolUse's, which does carry one]. A request is therefore keyed by its **request digest**: sha256 over `session_id`, `agent_id` (empty on the main thread), `tool_name` and the canonical JSON of `tool_input`. Two identical requests share a digest and a ruling, which is correct: the ruling is on the exact input. The transcript's `tool_use_id` is joined afterwards, for the journal only, from the PostToolUse that follows (same session, agent and input digest).

**The hook half (D-5297, fleet).** In the PermissionRequest arm, for any tool except AskUserQuestion (which keeps today's question path):
1. It engages only when all hold: the session is a child (`$REG/<id>.child` exists); the operator's arm marker `$REG/approvals-live` exists (§11's shadow week comes first) and `$REG/approvals-disabled` is absent, neither with a writer in the tree; the session's wait marker `$REG/<id>.approval-wait` exists (written by the server, §6.6); and the fleet's `server-caps` file is current and lists `coord-approvals-v1` (the working-state plan's capability-word mechanism, D-5232). Otherwise it does exactly what it does today.
2. It writes `$REG/approvals/<id>/<digest>.req` (0600): the digest, `agent_id`, `tool_name`, the full `tool_input` (capped at 64 KB; a larger input is marked `truncated` and is never allowed by a ruling), and its own start stamp. Then it writes the hookstate envelope as today, plus `digest`.
3. It runs the **static forbidden match** (§6.4, the second copy) on the full input. On a match it removes the request file and prints nothing: the prompt stays with the operator.
4. It polls for `$REG/approvals/<id>/<digest>.rule` every 500 ms for at most `APPROVAL_HOOK_WAIT_S` (540, under the managed 600 s hook timeout, `install-session-hooks.sh` `HOOK_TIMEOUT_S`). A rule file is `verdict allow|deny`, `digest <hex>`, `reason <one line>`, `end`. A torn, malformed or mismatched file is ignored.
5. On `allow` it prints the allow decision, with no `updatedInput` and no `updatedPermissions`, ever. On `deny` it prints the deny decision with `message` set to "denied by your coordinator: <reason>". It removes both files.
6. On timeout, on any error, or when the rule file never comes, it prints nothing, so the menu stays with the operator (fail open to the human). It never prints two envelopes.

**The server half (D-5298).** The server reads the request files through a new read-only `ccd approvals-pending <id>` (one JSON line per request) for sessions whose hookstate carries an approval envelope, and:
1. Mints an `approvals` row in `coord.db` per digest: child, parent (`parentOfSession`), tool, input digest, the input itself (as written, capped), guard class (§6.4), `askAt`, `notifyAt` (= `askAt + ASK_GRACE_MS`), state `held`. A forbidden-class or `truncated` request is minted `released` at once (no hold, the operator's push fires); the parent is not asked.
2. Mails the parent (system mail, kind `question`): the full command, the class, the deadline, and the ready-to-run `"$API" approvals rule <id> allow|deny --reason '…'` and `"$API" approvals release <id>` commands.
3. Holds the operator's push for the dialog while every open request row for that session is `held` (the pane shows one menu at a time; parallel subagent prompts each have their own row, because the hookstate slot is single, `session-hook.sh` ≈:4004–4022).
4. `POST /api/approvals/:id/rule` (mail-token gated, `requireMailToken`; the caller must be `parentOfSession(child)`): runs the guard first; refuses an `allow` the class does not permit (`409 guard-escalate`, `409 guard-forbidden`); then writes the rule file through a new whitelisted `ccd approval-rule <id> <digest> allow|deny` (reason on stdin), re-checking on the box that the request file still exists and names the same digest. States: `held → ruling → allowed | denied`, `held → declined` (the parent's release), `held → released` (the 180 s lapse; a ruling is still taken), `→ operator` (the dialog closed with no rule file written, or the operator answered through `/dialog`), `→ stale` (the session ended or the request file vanished). The vocabulary has one home (`APPROVAL_STATE_MAP`, `shared/api.ts`), read through `isApprovalState`.
5. Late ruling wins until the operator acts: after the 180 s push, a ruling is still accepted while the hook waits (to 540 s from the request) and the dialog is up; the operator's notification is replaced by "allowed by <parent>" or "denied by <parent>". After the hook has given up, a ruling is refused `409 hook-gone` and the parent's mail says the operator has it.
6. `POST /api/sessions/:id/dialog` on an approval records `operator` on the open row before it presses keys, so every approval has an answering principal.

### 6.4 Guardrails (D-5299)

The guard is code that runs before any allow is written. The coordinator's word can only narrow it. One pure classifier, `approvalClass(tool, input, ctx)` in `server/src/coord/approvalguard.ts`, answers one of three classes; `ctx` carries the child's worktree, its scratch directory and the box's temp root.

| Class | Examples (full list in the classifier and its corpus fixture) | What the parent may do |
|---|---|---|
| `forbidden` | every `ccd` verb the SAFETY section forbids to sessions (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim`, `ws-expire`, `ws-collect`); any `tmux` command; a write or delete under `~/.cc-sessions`, `~/.cc-limits` or `~/.ccrc`; `systemctl`, `systemd-run` or `kill` aimed at `claude-session@*`, `ccrc*` or the tmux server's scope; `reboot`, `shutdown`; `ccrc update`, `ccrc rollback`, `ccrc history`'s writing forms; an edit to a Claude settings file, a hook script or a `CLAUDE.md` hook block; printing a secret file's contents | nothing: never held, never mailed, straight to the operator |
| `escalate` | `rm -r`/`-rf` whose resolved target is outside the child's worktree, scratch directory or temp root, or of `/`, `~`, `$HOME`, or a variable not assigned earlier in the same command; `git push --force`/`-f`, a push to `main`/`master`, `git reset --hard` or `git clean -f` outside the worktree, `git branch -D`; reads of credential paths (`~/.ssh`, `~/.cc-secrets`, `*.token`, `.env`, `credentials`, `auth.json`, `.netrc`, `*.pem`); network egress (`curl`, `wget`, `ssh`, `scp`, `rsync`, `nc`, `/dev/tcp`); `sudo`; a non-Bash tool whose class the classifier does not know | deny, or hand over to the operator; never allow |
| `ordinary` | everything else, e.g. `rm -rf "$X"` where `X` is assigned in the same command to a path inside the worktree, scratch directory or temp root | allow once, deny, or hand over |

Procedure rules, each enforced in code:
- **Allow once only.** The hook never emits `updatedPermissions` or `updatedInput`; the rule route has no field for either.
- **The hook's second copy.** The hook carries a static bash match for the `forbidden` class only, held equal to the classifier by a test that iterates over one shared corpus fixture (`server/test/fixtures/approvals/guard-corpus.json`, neutral commands, each with its expected class).
- **A settings backstop.** Every rostered home's settings gain `permissions.deny` rules for the `forbidden` verbs that have a stable command prefix (`Bash(ccd ws-rm:*)` and its siblings, `Bash(ccrc update:*)`, `Bash(ccrc rollback:*)`); deny rules override a hook allow in Claude Code [B]. These verbs are already forbidden to every session, so the rule binds nobody who may run them.
- **Prompt injection.** The coordinator reads commands a model wrote, which may carry text from untrusted input. That is why the class is computed by code, and why a coordinator's "allow" on an `escalate` request is refused, however it is argued.
- **Journal.** Every ruling, refusal, hand-over and lapse is a row (the `approvals` table is the journal): child, parent, tool, input digest, class, verdict, reason, the answering principal, mint-to-ruling latency, and the joined `tool_use_id`. Rows are never pruned by this programme.

### 6.5 Unproven, and the stop rule

The live test covered a main-thread prompt in default mode. Whether a hook allow also resolves the safety-check prompts raised inside subagents of a bypass-mode session (25 of 26 measured) is untested, because that prompt did not reproduce locally. The plan's verification task (Task 11) must reproduce it on a throwaway rig on each Claude Code version the fleet runs, before the hook half arms. **Stop rule:** if a hook allow does not resolve a subagent prompt on a version, that version is left out of `APPROVAL_HOOK_VERSIONS` and its prompts keep going to the operator as today; if no fleet version passes, the permission half ships only for main-thread prompts and the plan says so.

### 6.6 Version drift

"The menu paints while the hook waits" and "a pane answer kills the hook" were measured on one version. A future Claude Code that blocks the menu until hooks finish would lock the operator out for up to 540 s. So:
- `APPROVAL_HOOK_VERSIONS` (one home, `shared/api.ts`) lists the versions on which a recorded rig capture proved both behaviours (Task 11).
- The server writes `$REG/<id>.approval-wait` (through `ccd approval-wait <id> on|off`) only while the child's live `version` is in that list, and removes it within one tick when it is not (a swap or restart onto another version). The hook waits only while the marker exists.
- A capture fixture of the 2.1.302 behaviour is committed and replayed by a rig test, so a version is added only with evidence.

## 7. The quiet "with coordinator" state (D-5296)

- **A wire field, not a bucket.** `FleetSession.withCoordinator: {kind: 'question' | 'approval', parentId, since, notifyAt} | null`, additive, computed in `assembleFleet` from the open `asks` or `approvals` row while it is `held` or `ruling`/`answering` and `now < notifyAt`. `reviveFleetSession` answers null (an old snapshot shows Needs-you, the safe direction). No new `SessionBucket` member; `FLEET_PROTO` stays 1.
- **The ladder.** `BucketInput` gains `withCoordinator`; in `sessionBucket` the attention rung (`dialogPending || hookState === 'waiting'`, `shared/api.ts` ≈:1531) is skipped while it is set, and the row falls to `working`, with `bucketSince` the hold's `since`.
- **The PWA** words it "with coordinator" (the parent's short name beside it) on the card and in the header, in the calm tone, and keeps the dialog answerable from the session screen: the operator can still answer first.
- **The return.** At `notifyAt`, on `declined`, or on a guard hand-over, the field clears, the row returns to Needs-you, and the push fires. A late coordinator answer clears it the other way.
- The existing `ask` chip (`FleetSession.ask`) keeps its meaning for the "answered by" line after the fact.

## 8. Manual sessions start as coordinators (D-5301)

- **A durable declaration at birth.** Every operator-created session is marked: the PWA "+" path passes `--surface pwa --actor operator --role coordinator` to `ccd ws-add` (today it passes nothing), and the create-session and start-programme paths (`POST /api/sessions`, `server.ts` ≈:2638) mark their session through a new `ccd role-set <id> coordinator`. `ccd` writes `$REG/<id>.role` holding `coordinator` and the row's generation, so a recycled slug never inherits a stale role; `ws-add` for a dispatched child refuses `--role`. The server passes the flag only when `ccd caps` lists `ws-add-role` (`capSupported`), so a fleet behind its server degrades to today's bare create.
- **A start-time sentence, not a kickoff.** The SessionStart card gains one paragraph for a session whose `.role` reads `coordinator` and that has no `.child` and no hold: "You are a coordinator for this project. For work worth splitting, run the `ccrc-coordinator` skill and dispatch; your children's questions and permission prompts come to you first; your own go to the operator." No kickoff mail, no eager skill load: 18 of 29 manual workspaces never dispatch, and the skill costs about 10k tokens plus 22k for the wave lifecycle.
- **The role guards.** A dispatched child never reads the sentence (the card gates on no `.child` and no hold). The merge deny is unchanged (hold plus `.child`).
- `FleetSession.role: 'coordinator' | null`, additive, for a badge before any run exists.
- Coordinator-ness is still not parenthood (§4): ad-hoc single-task dispatch keeps needing a run. A lighter run kind is out of scope.

## 9. The empty push body (D-5302)

Both raise sites push `body: dialog.title || 'Claude has a question'` (`watch.ts` ≈:7812, ≈:8280); 14 of 36 bodies were a lone box-drawing glyph. One helper, `askPushBody(hs, dialog)`, builds the body: for a question envelope the first question's text; for an approval envelope `tool: summary` (`hookAskSummary`, `fleet.ts` ≈:65); otherwise the dialog title only when it has a letter or digit after stripping box-drawing and block characters; otherwise "Claude has a question". The coordinator's replacement bodies ("with coordinator", "answered by", "allowed by") are built by the same module.

## 10. The daily digest (D-5300)

- **What.** For the 24 hours before the digest hour, per coordinator: every question it answered (child, question, chosen option or words, time), every approval it allowed or denied (child, tool, the command's first 160 characters, class, reason, time), every hand-over and every lapse; totals at the top; refusals by the guard counted. Built only from the `asks` and `approvals` tables, which are durable (the feed ring keeps about 1.5 days and is not a source).
- **When.** Once a day at `DIGEST_HOUR_UTC` (default 07, overridable by `~/.ccrc/digest-hour`); idempotent per day through a `digests` row, so a restart never sends two; skipped when there were no decisions.
- **Where it lands.** One push of the existing kind `coord` ("Coordinators decided 23 things in your name"), recorded in the feed, opening a digest screen in the PWA backed by `GET /api/digest?day=` (session-gated). The digest is also the `GET` answer for any past day, so a missed push loses nothing.
- **How the operator corrects.** Each line has "Correct": the operator types a sentence, and `POST /api/digest/correct` (session-gated) queues durable system mail from `operator` to that coordinator (kind `finding`, subject naming the ask or approval id, the operator's text verbatim), through the existing mail store. The coordinator skill's clause 11 gains: an operator correction is a ruling; record it in the ledger and apply it to later asks. A correction also marks the row `corrected`, which is what §11 counts.

## 11. Measurement plan

Baseline is §2's 7 days. The same window is re-measured 7 days after each half is armed, read-only, from `coord.db` (`asks`, `approvals`, `mail`, `feed_events`) and transcript shapes.

| Metric | Baseline | Target |
|---|---|---|
| child questions reaching the operator | 18 of 37 (49%) | at most 20% |
| of those, lost to a lapse with a parent answer ready | 3 | 0 |
| of those, the first-sighting race | 6 | 0 |
| child permission prompts reaching the operator | 26 of 26 (100%) | at most 25% (the escalate class) |
| child wait on a permission prompt, median | about 994 s | at most 120 s |
| child wait on a question, median (all child asks) | dominated by 2.5 h operator answers | at most 120 s |
| `forbidden`-class allows | n/a | 0, a hard stop (disarm) |
| wrong rulings: rows the operator corrected from the digest, plus coordinator allows the operator reverted | not measured | at most 5% of rulings |
| empty push bodies | 14 of 36 | 0 |

Before the hook half arms, a **shadow week** (the plan's Task 16; until the operator places `approvals-live`, the hook never waits) mails the parent and records its ruling while the hook does not wait, so each shadow ruling is compared with the operator's own answer on the same digest: the wrong-ruling rate is measured before any ruling takes effect. The arm marker is placed only if the shadow week shows no `forbidden` allow and a disagreement rate at most 5%.

## 12. Invariants

1. A coordinator never presses keys in a child's pane for a permission prompt; only the child's hook prints a decision.
2. No `forbidden`-class request is allowed by anyone but the operator.
3. No ruling writes a persistent permission or changes a session's mode.
4. Any failure of the permission half leaves the prompt with the operator, as today.
5. The operator can always answer first; their answer ends the row.
6. Every coordinator decision in the operator's name has a journal row and appears in the next digest.
7. Manual sessions' own questions and prompts reach the operator exactly as today.
8. A fleet ahead of its server, or a server rolled back, behaves as today (capability words and `ccd caps`).

## 13. Out of scope

Nested coordinators (stay refused); a lighter run kind for ad-hoc dispatch; routing top-level sessions' prompts anywhere but the operator; settings allow rules; multi-hop escalation; any coordinator act on a non-child session.
