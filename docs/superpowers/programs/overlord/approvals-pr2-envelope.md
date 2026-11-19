# Approvals PR 2, the per-agent envelope and the untrusted-build item: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main`), §2's path 6, §3.2.2 and Tasks 2.1 and 2.2.
Departures are listed by slug. The coordinator mints the numbers. Fix round 1 answers review 2752's F1 to F7, and fix
round 2 review 2774's F1 to F6, as the coordinator ruled them; each change below names its review and finding.

## What shipped

- **Task 2.1, the hook.** Hook state gains one additive list, `approvals`: one entry per subagent call whose permission
  prompt stands, `{agentId, tool, summary, route, at}`, `at` being the PermissionRequest write's own stamp. A subagent's
  PermissionRequest (not AskUserQuestion) adds its entry. That agent's own tool event for the same call (PreToolUse,
  PostToolUse), its SubagentStop and the transcript tie's tool_result remove it. Every other event carries it as read:
  a parallel call's events, the main thread's `PreToolUse`, `PostToolUse`, `UserPromptSubmit` and `Stop`, and a
  sibling's tool events, with or without a `waitPrev`, so `ask` may be erased or restored while the list keeps the
  prompt. The hook's prefilter read takes the list, and the event's call key, in its one jq fork, and the write's one jq
  builds the list, so no event pays a new fork; only the tie's drop is a new write, made when the wait sees the pane
  answered. **The session hook grows by 18 net code lines against `main`** (29 added, 11 removed, counting lines that are
  neither blank nor whole-line comments; 36 net counting every line), within the brief's 40.
- **Task 2.1, the readers.** `hookstate.ts` is the list's one reader (`reviveApprovalEntries`). One L1 decider,
  `server/src/coord/approvalEnvelope.ts#paintedApprovalOf` (over `approvalEntryFor`), answers which envelope is the
  prompt the pane paints, and the three converted readers ask it: the session stream's `ask` frame
  (`sessionws.ts#applyHook`, over the menu it last sent), the approval hold (`questions.ts`'s `holdApproval`, through
  `raise`) and the census (`observeCensus`). A matching entry's envelope is marked `thread: 'subagent'` (additive on
  `HookAsk`'s approval arm), and `wireHookAsk` keeps the mark. Two readers still read hook state's own `ask` (review 2752
  F5): the answer door's operator mark and the restart reseed. Neither is a regression: a subagent's row is settled by
  `settleClearedApproval` on the next tick, and the reseed only ever carries main-thread rows.
- **Task 2.1, honest attribution (review 2752 F1 and F2; review 2774 F1 to F5).** The console shows the envelope's text
  over a menu the operator is about to answer, so the decider takes an entry only when it is the best and an honest match:
  - a summary under 60 non-space characters must appear whole, and one under 12 (`APPROVAL_MATCH_MIN_CHARS`) only as the
    menu's command block;
  - "exact" means the command block: a paragraph of the menu's body (a real capture paints a blank line around it,
    `cc280-permission.txt`), or that paragraph less its last line, the tool's description, the pane's wraps joined. One
    line inside a paragraph is never it (2774 F2);
  - candidates rank by a full 60-character match, then an exact one, then the longest, then the tool the menu names, and
    only then the newest, so an exact match shorter than the 60-character head never outranks a 60-character match
    (2774 F2);
  - hook state's own `ask` competes on the same match ranking (full, exact, longest) and wins its ties: a substring own
    ask never beats an entry that is the command block (2774 F1). When a subagent raised it (`waitBy: 'subagent'`), its
    entry is the one the same write added (the same tool and summary, stamped `at` = hook state's `updatedAt`), and that
    entry is taken under the same age rule; with none, there is no entry, never another agent's identical one (2774 F5);
  - an entry is ignored once the hook's longest wait and 15 minutes have passed since its request's stamp
    (`APPROVAL_ENTRY_MAX_AGE_MS` = `APPROVAL_HOOK_WAIT_S` + `APPROVAL_MENU_ANSWER_MS`, 2774 F3), or when its stamp is more
    than a minute ahead of the reader's clock (`APPROVAL_ENTRY_MAX_AHEAD_MS`, 2774 F4); its menu then falls back to path
    6, the bare menu;
  - lengths count code points, as the hook's jq cuts the summary.
- **Task 2.1, the console.** The approval surface shows "One of its subagents asks to run a Bash call." above the
  summary when the envelope is a subagent's, with Allow and Deny, and never the kicker "Claude needs a choice"
  (`EnvelopeSheet.tsx`, `askWords.ts#subagentAsksLine`).
- **Task 2.2.** A `version-unverified` refusal raises one Waiting on you item per untrusted build, keyed by the build: the
  item carries the action `{verb: 'untrusted-build', build}` (`shared/ledgers.ts`), and `untrustedBuildItemOf` (L1,
  `server/src/coord/untrustedBuildItem.ts`) raises none while that build's item is open. The questions owner raises it
  in `raiseApproval`'s refusal arm; the read and the raise run with no await between. The capture lane's pass settles
  each open item whose build the record now trusts (`untrustedBuildItemsToSettle`), within a minute of the capture.
- **Task 2.2, the item's control (fix round 1, F4).** The item's first step names `/settings/automation`
  (`UNTRUSTED_BUILD_SETTINGS_PATH`, L0), which the console draws as a link (`linkRuns`), to Settings' Automation section,
  whose Test box build list holds the build's row and its Capture again. Its text says plainly that a build waiting for its
  capture stays waiting while no test box can capture it (none is reachable, or the box has no capture runner). No new
  door, and no Dismiss for this verb.
- **The census.** A subagent's menu with a sibling's events between ticks (the sibling's own prompt in `ask`, then its
  tool events erasing `ask`) counts once, keyed by the entry (the brief's carry). Two subagents asking the same command,
  or one asking it twice, are two rows (fix round 1, F3): an entry's agent id and own stamp are part of the sighting-start
  comparison, so the second menu, painted under the same menu labels within `ASK_SETTLE_TICKS`, starts its own sighting.
  A main-thread envelope's restamp is still one prompt.

## Departures

- `entry-picked-on-the-server`: the plan has `askSource` pick the matching entry. The server picks it instead
  (`paintedApprovalOf`, over the dialog the stream last sent) and sends it as the `ask` frame, marked `thread:
  'subagent'`; `askSource` reads that frame as it always read an approval. One decider serves the three converted
  readers, the list never goes on the wire, and `hookstate.ts` stays its one reader. An older PWA shows the same approval
  surface without the subagent line.
- `honest-match` (replaces `match-by-summary-tool-breaks-ties`, review 2752 F1): the match rules above. A summary is
  matched with whitespace removed on both sides, because the pane wraps commands, mid-word too. The tool name ranks
  after exactness and length, because Claude Code's header words differ by tool ("Bash command", "Edit file") and do not
  always contain the tool's name.
- `own-ask-competes` (replaces `own-ask-first`, review 2774 F1; that replaced `entry-wins-over-ask`, review 2752 F1):
  hook state's own approval is the painted prompt when the menu matches it at least as strongly as the best entry. Only
  the same-call case keeps `own-ask-first`'s exception: when a subagent raised it (`waitBy: 'subagent'`), the own ask and
  the entry the same write added are one prompt, and the entry is taken. That keeps one census key, the entry's own
  stamp, from the PermissionRequest's tick through a sibling's events, so the carried census case still counts once. The
  same-call entry is found by its stamp, because hook state carries no asking agent's id.
- `entry-age-bound` (review 2752 F2 and review 2774 F3, the coordinator's rulings): the server ignores an entry once the
  hook's wait ceiling and 15 minutes have passed since its request's stamp, so a background menu painted at the ceiling
  still has 15 minutes. It also ignores an entry stamped more than a minute ahead of its clock (review 2774 F4), so a
  wild stamp never stays forever. The safe direction is the bare menu. A clock skew under a minute between the fleet box
  (the stamp) and the server (the reader) moves the age bound by the skew.
- `drop-by-own-call` (F6): the ruling says to remove an entry by its agent id and its own stamp. A later event cannot
  name the stamp, because no PermissionRequest carries a `tool_use_id` (the hook's resolution-signal note). So an agent's
  tool event removes only the entry whose tool and summary are that event's call: one jq expression
  (`APR_SUMMARY_JQ`) builds both the envelope's summary and the event's key, so they agree byte for byte. A parallel call's
  PostToolUse no longer drops a standing prompt. A `tool_input` the key cannot index (not an object) leaves the hook
  running (`try`, review 2774 F6); its empty key removes the agent's entries, as a SubagentStop does. The transcript tie and PR 1's route patch still key on agent and stamp,
  and a SubagentStop removes every entry of its agent. A denied prompt's entry stays until its agent's SubagentStop, its
  same call again, or the age bound; it names no other menu (`honest-match`).
- `same-call-replaces` (replaces `same-agent-replaces`, F6): a later PermissionRequest of the same agent for the same
  call replaces its entry; another call of that agent is another entry. The list is bounded to the newest 16 entries.
- `session-start-empties`: the plan carries the list through every other event. A SessionStart (startup, resume, clear)
  empties it, as it empties the subagent roster: the agents died with the old process. A compaction keeps it (its
  SessionStart exits before the write).
- `tie-drop-rereads-the-file`: the tie's removal reads the file as it stands when the wait sees the tool_result, and
  removes only the entry with this agent's id and this write's stamp. A hook write landing inside its one jq fork is
  overwritten, as every two hook writes race (no lock), the same window PR 1's route patch has.
- `route-patch-patches-the-entry`: PR 1's route patch (`request-refused:<word>`, `request-failed`) patches the entry's
  route too, under the same own-bytes rule, so a sibling write before the patch leaves the entry `sent`, as it leaves
  the envelope.
- `hold-takes-the-entry-agent`: `holdApproval` covers the held rows of the painted prompt's own agent: the entry's agent
  for a subagent's menu, the main thread (`''`) otherwise, as before (D-5491). A subagent's menu paints after its hook
  returned, so its row is rarely still inside its window then.
- `census-key-entry-stamp`: a painted entry's census key is its own stamp (`env:<at>`), the same value PR 1's key took
  on the PermissionRequest's tick, and its own minted row is matched by its agent id, never merely by thread. The
  census row still keeps its thread, not the agent id (`census-thread-not-agent-id` is not widened).
- `summary-in-code-points` (F7): the reader bounds an entry's summary at 200 code points, as the hook's jq cuts it, so a
  wide command's entry is read, not dropped.
- `cap-keeps-the-list`: the hookstate write's 64 KB cap still drops the question envelope only. The list is at most 16
  entries of 200-character summaries.
- `no-capability-word`: `approval-envelope-v1` is not added. Nothing would read it: an older server ignores the field
  and an older hook writes none, which this reader reads as none. PR 0 and PR 1 dropped theirs for the same reason.
- `item-on-the-overlord-programme`: the item is raised on the `overlord` programme (the quiz lane's precedent), kind
  `do`, `soon` with no label (nothing pushes; the capture lane's own failure notice already does), so no new reserved
  programme name is needed.
- `captured-build-settles`: the plan says a captured build withdraws the item. Withdraw is the coordinator's move, so
  ccrc settles it (`settle`, actor `ccrc`) on the capture lane's next pass after the record says pass.
- `item-links-the-section` (F4, the coordinator's ruling): the ruling asks for a link to Settings' Capture again row for
  the build. Settings has no address for one row (no fragment is scrolled to), so the step links the Automation section
  and names the build, whose row in the Test box's build list carries Capture again. No new console mechanism.
- `no-item-without-a-build`: `unread` (the child's build could not be read) and `record-unreadable` raise no item:
  neither is a fact about a build, and neither has one to key by.

## PR 1's accepted residuals (`path-6-is-a-floor`)

- **Narrowed: path 6 itself.** A subagent's prompt whose entry matches the painted menu is counted by its own route
  word, never as an erased envelope. Path 6 remains for a menu no entry matches (an older hook, a long command, a short
  command painted with other text, an entry past the age bound) and for a main-thread envelope erased by its own events.
- **Closed where an entry matches: F3** (an older hook restamps a subagent-raised wait, so a flicker or a restart can
  key the same prompt by a second `env:` stamp). A painted entry's key is its own stamp, which no later event changes.
  With no matching entry (an older hook, a long command, an empty summary, an entry past the age bound) the key falls
  back to hook state's stamp, which can still be restamped.
- **Closed where an entry matches: F4** (two erased prompts of one dialog id first seen at the same hook stamp share a
  key). Each subagent's prompt keeps its envelope and is keyed by its own stamp, and two prompts for the same command
  are two sightings (F3 of review 2752).
- **Narrowed: F6** (no push source for an envelope-less menu). A subagent's painted menu with a matching entry now has
  an envelope, so its sighting is decided on its first tick and its push carries `census:` or `approval:` as any
  envelope's does.
- **Not touched:** F2(1) (a server restart while an erased menu stands) and F8 (a menu-only row's `seenAt`).

## Accepted residuals

- `long-command-unmatched`: a command whose first 60 characters are painted above the dialog's 20-line preamble window
  (`pane/dialog.ts`'s `header`), or that Claude Code paints differently from its input, matches no entry: the console
  shows the bare menu, as before, and the census counts it as before. The same holds for a short command (under 12
  non-space characters) that is not the menu's whole command block.
- `identical-commands`: two subagents prompting for the same command at once both match; the newest entry is taken, so
  the surface, the hold and the census name the newer agent's prompt while the older one's menu is painted. The surface
  reads the same either way. Each prompt is still its own census row (F3).
- `same-stamp-shares-a-key`: the census row's key stays PR 1's (`env:<at>`). Two subagents' prompts stamped in the same
  millisecond start two sightings (the agent id is in the comparison), and each finds its own minted row as its push
  source, but an envelope-less decision of both would share the key, and the store keeps the first row.
- `undescribed-script-head`: a menu painted with no description line has its command block's last line set aside as if it
  were one, so a short entry equal to every line but the last of a multi-line script is exact there. It still loses to
  an entry matching the script's first 60 characters (the ranking above).
- `parallel-identical-calls`: one agent running two identical calls in parallel (the same tool and summary) shares one
  call key, so the first call's event removes the other's standing entry. Its menu then falls back to path 6.

## Mutation measurements

Every guard was measured red by a mutant, each file restored from a copy saved before the first mutant and checked byte
for byte.

- **L1 deciders, in `MUTANT_SETS` and `mutation-floors.json` (floor 1 each), all killed.** Fix round 2 rewrote the
  envelope's two sets against the reworked decider and ran each mutant through the suite that runs the same cases
  module (`approval-envelope.test.ts`), because the floors suite is killed by the test slice's memory cap on this box:
  - `approvalEntryFor`, 33: no shape check; the title or the body unread; whitespace kept; a long summary required whole;
    a 50-character match; a short summary matched as a substring; a short bound of 10; no command-block test; any one
    line taken as the command (2774 F2); the description never set aside; two lines set aside; an empty summary a command
    block; a blank line ending no paragraph; a full 60-character match not ranked first (2774 F2); exactness, length or
    the tool not ranked; a full match needing more than 60; the oldest winning; recency ranked first; the first match
    winning; an empty tool naming every menu; no null-menu check; no age bound; the age bound excluding its edge; the
    hook's wait left out of it (2774 F3); a 10-minute answer window; no bound ahead, the bound ahead excluding its edge,
    or a two-minute one (2774 F4); lengths, and the head's cut, in UTF-16 units.
  - `paintedApprovalOf`, 17: no null check; hook state's own approval never competing, taken for any menu, taken with no
    menu check, always matching, or winning whatever the entry (2774 F1); a tie going to the entry; no same-call entry; a
    same-call entry for the main thread too; the same call by any stamp or of any age (2774 F5), by summary only or by
    tool only; no subagent mark; the route dropped; the entry unreported; a bound of 17.
  - `untrustedBuildItemOf`, 10: the eight of the first round (THE KEY dropped, a read failure raising, no build to key by
    raising, a failed capture no fact, no action, another programme, a blocking item, any action read as the key), and
    fix round 1's two: the step linking nothing, and a waiting build said to be captured on its own.
  - `untrustedBuildItemsToSettle`, 3 (first round; the function is unchanged).
- **The hook, 21 hand mutants, all killed** (`session-hook-approval-envelope.test.ts`). The first round's 14: the plan's
  two (a main-thread event clears the list; a sibling's restore of `waitPrev` clears it), and any agent's event dropping
  every entry, its own events not dropping it, no add, the main thread adding, no bound, a SessionStart keeping it, the
  tie dropping nothing or everything, the list never read back, no route, a foreign stamp, and the route patch leaving the
  entry. Fix round 1's 6: any event of the agent dropping every entry (F6), its own call never dropping, a SubagentStop
  keeping the call key, the key naming another tool, a PermissionRequest replacing nothing, and the summary cut at 201
  code points (F7). Fix round 2's 1: the call key without its `try` (2774 F6).
- **The readers, 30 hand mutants, all killed.** The first round's 22: the hold (the entry's agent ignored, hook state's
  `ask` taken, the filter pinned to the main thread), the census (keyed by hook state's stamp and thread, hook state's
  `ask` taken, its own row matched by thread), the reader (the list never read, and seven entry guards), the stream (hook
  state's `ask` sent, the list unread), the wire (the mark dropped), the raise (no item, THE KEY ignored at the store), the
  capture lane (no settle) and the console (no subagent line; every approval saying it). Fix round 1's 8: the sighting
  without the agent and the stamp, without the stamp, and without the agent (F3); the hold, the census and the stream
  reading no clock (F2); the reader counting UTF-16 units (F7); and the item's path an unrouted one (F4, the console's
  link test).
- **Red first:** the hook suite ran 14 of 17 cases red against the unchanged hook before the first round's hook change
  (the three green ones assert an absence), and each reader suite's mutants above stand in for its red run. Fix round
  1's cases were each red against the round's mutant of the guard they pin. Fix round 2's ran red against fix round 1's
  decider (ten cases: the bounds, the command block, the 60-character rank, both age bounds, C1 and C2 on the decider,
  the same-call entry, and C1's hold and C2's census on the readers) and its hook (the non-object `tool_input`).

## For the ledger

- `typecheck-tests` reddened three times on this branch with the test slice's memory cap killing `tsc` (2 to 10 OOM kills
  a run, `MemoryMax=6G`); once the one real type error was fixed, the file passed whole, alone. Measured, not fixed: the
  cap and the file's concurrency are not this PR's.
- The first CI run reddened `mail-routes.test.ts`'s kebab scan of `server/src/coord`: `untrustedBuildItem.ts` quotes three
  `BuildUntrustedReason` words, which no admission named. They are admitted through L0's `BUILD_UNTRUSTED_REASONS`, as
  every other lane's words are. That suite was not among the ones run before the push.
- Horkos's `rules-mixed` names `ccd/session-hook.sh`: a PR that changes a rules file may change nothing else. The brief
  puts the hook and its readers in one PR, so the split is left to the coordinator.
- Fix round 1's first push reddened `session-hook-turnmark.test.ts`, which pins the prefilter's `read` list by content: the
  call key's read (`ap_call`) is in it now. That suite was not among the ones run before the push.
- `sim/mutation-floors` is killed by the test slice's memory cap on this box (the reviewer measured it twice); its sets'
  mutants were run here one by one through the suites that run the same cases modules, and CI is its arbiter.
- Fix round 2: the reader suite's hand-made pane (`approval-envelope.test.ts`'s `paneFor`) painted no blank lines, which
  a real capture does (`cc280-permission.txt`), so the command block could not be read from it; it now paints them.
  `typecheck-tests` was killed by the memory cap again, so the changed test files were typechecked through a narrow
  config extending the suite's own; one real error (a case without `updatedAt`) was found and fixed that way.
