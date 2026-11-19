# Approvals PR 2, the per-agent envelope and the untrusted-build item: task note

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (on `main`), §2's path 6, §3.2.2 and Tasks 2.1 and 2.2.
Departures are listed by slug. The coordinator mints the numbers.

## What shipped

- **Task 2.1, the hook.** Hook state gains one additive list, `approvals`: one entry per subagent whose permission prompt
  stands, `{agentId, tool, summary, route, at}`, `at` being the PermissionRequest write's own stamp. A subagent's
  PermissionRequest (not AskUserQuestion) adds its entry; that agent's own next tool event (PreToolUse, PostToolUse), its
  SubagentStop and the transcript tie's tool_result remove it. Every other event carries it as read: the main thread's
  `PreToolUse`, `PostToolUse`, `UserPromptSubmit` and `Stop`, and a sibling's tool events, with or without a `waitPrev`,
  so `ask` may be erased or restored while the list keeps the prompt. The hook's prefilter read takes the list in its
  one jq fork, and the write's one jq builds it, so no event pays a new fork; only the tie's drop is a new write, made
  when the wait sees the pane answered. The session hook grows by 29 net code lines (the brief's limit is 40).
- **Task 2.1, the readers.** `hookstate.ts` is the list's one reader (`reviveApprovalEntries`). One L1 decider,
  `server/src/coord/approvalEnvelope.ts#paintedApprovalOf` (over `approvalEntryFor`), answers which envelope is the
  prompt the pane paints, and the three readers ask it: the session stream's `ask` frame (`sessionws.ts#applyHook`, over
  the menu it last sent), the approval hold (`questions.ts`'s `holdApproval`, through `raise`) and the census
  (`observeCensus`). A matching entry's envelope is marked `thread: 'subagent'` (additive on `HookAsk`'s approval arm), and
  `wireHookAsk` keeps the mark.
- **Task 2.1, the console.** The approval surface shows "One of its subagents asks to run a Bash call." above the
  summary when the envelope is a subagent's, with Allow and Deny, and never the kicker "Claude needs a choice"
  (`EnvelopeSheet.tsx`, `askWords.ts#subagentAsksLine`).
- **Task 2.2.** A `version-unverified` refusal raises one Waiting on you item per untrusted build, keyed by the build: the
  item carries the action `{verb: 'untrusted-build', build}` (`shared/ledgers.ts`), and `untrustedBuildItemOf` (L1,
  `server/src/coord/untrustedBuildItem.ts`) raises none while that build's item is open. The questions owner raises it
  in `raiseApproval`'s refusal arm; the read and the raise run with no await between. The capture lane's pass settles
  each open item whose build the record now trusts (`untrustedBuildItemsToSettle`), within a minute of the capture.
- **The census case the list makes reachable** (the brief's carry): a subagent's menu with a sibling's events between
  ticks (the sibling's own prompt in `ask`, then its tool events erasing `ask`) counts once, keyed by the entry
  (`approval-envelope.test.ts`). Before this PR the sibling's prompt in `ask` started a second sighting under the same
  painted menu, and so a second row.

## Departures

- `entry-picked-on-the-server`: the plan has `askSource` pick the matching entry. The server picks it instead
  (`paintedApprovalOf`, over the dialog the stream last sent) and sends it as the `ask` frame, marked `thread:
  'subagent'`; `askSource` reads that frame as it always read an approval. One decider serves all three readers, the
  list never goes on the wire, and `hookstate.ts` stays its one reader. An older PWA shows the same approval surface
  without the subagent line.
- `match-by-summary-tool-breaks-ties`: an entry is the painted prompt when the menu is approval-shaped (PR 1's
  `approvalShapedMenu`) and the first 60 non-space characters of its summary appear in the menu's title and body, with
  whitespace removed on both sides (the pane wraps commands, mid-word too). The tool name only breaks a tie (the newest
  entry after that), because Claude Code's header words differ by tool ("Bash command", "Edit file") and do not always
  contain the tool's name. An entry with an empty summary matches nothing.
- `entry-wins-over-ask`: a matching entry is the painted prompt whatever hook state's own `ask` holds at that tick (a
  main-thread question a sibling's event restored, or another subagent's newer prompt).
- `session-start-empties`: the plan carries the list through every other event. A SessionStart (startup, resume, clear)
  empties it, as it empties the subagent roster: the agents died with the old process. A compaction keeps it (its
  SessionStart exits before the write).
- `same-agent-replaces`: a later PermissionRequest of the same agent replaces its entry. The list is bounded to the
  newest 16 entries.
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
- `cap-keeps-the-list`: the hookstate write's 64 KB cap still drops the question envelope only. The list is at most 16
  entries of 200-character summaries.
- `no-capability-word`: `approval-envelope-v1` is not added. Nothing would read it: an older server ignores the field
  and an older hook writes none, which this reader reads as none. PR 0 and PR 1 dropped theirs for the same reason.
- `item-on-the-overlord-programme`: the item is raised on the `overlord` programme (the quiz lane's precedent), kind
  `do`, `soon` with no label (nothing pushes; the capture lane's own failure notice already does), so no new reserved
  programme name is needed.
- `captured-build-settles`: the plan says a captured build withdraws the item. Withdraw is the coordinator's move, so
  ccrc settles it (`settle`, actor `ccrc`) on the capture lane's next pass after the record says pass.
- `no-item-without-a-build`: `unread` (the child's build could not be read) and `record-unreadable` raise no item:
  neither is a fact about a build, and neither has one to key by.

## PR 1's accepted residuals (`path-6-is-a-floor`)

- **Narrowed: path 6 itself.** A subagent's prompt whose entry matches the painted menu is counted by its own route
  word, never as an erased envelope. Path 6 remains for a menu no entry matches (an older hook, a long command, see
  `long-command-unmatched` below) and for a main-thread envelope erased by its own events.
- **Closed for this hook: F3** (an older hook restamps a subagent-raised wait, so a flicker or a restart can key the
  same prompt by a second `env:` stamp). A painted entry's key is its own stamp, which no later event changes. A box
  still running an older hook keeps F3 until it updates.
- **Closed where an entry matches: F4** (two erased prompts of one dialog id first seen at the same hook stamp share a
  key). Each subagent's prompt keeps its envelope and is keyed by its own stamp.
- **Narrowed: F6** (no push source for an envelope-less menu). A subagent's painted menu with a matching entry now has
  an envelope, so its sighting is decided on its first tick and its push carries `census:` or `approval:` as any
  envelope's does.
- **Not touched:** F2(1) (a server restart while an erased menu stands) and F8 (a menu-only row's `seenAt`).

## Accepted residuals

- `long-command-unmatched`: a command whose first 60 characters are painted above the dialog's 20-line preamble window
  (`pane/dialog.ts`'s `header`), or that Claude Code paints differently from its input, matches no entry: the console
  shows the bare menu, as before, and the census counts it as before.
- `identical-commands`: two subagents prompting for the same command at once both match; the newest entry is taken, so
  the hold and the census may name the other agent's prompt. The surface reads the same either way.

## Mutation measurements

Every guard was measured red by a mutant, each file restored from a copy saved before the first mutant and checked byte
for byte.

- **L1 deciders, in `MUTANT_SETS` and `mutation-floors.json` (floor 1 each), 29 mutants, all killed:**
  `approvalEntryFor` (12: no shape check, the title or the body unread, whitespace kept, the whole summary required, a
  50-character match, an empty summary matching, no tool preference, the oldest winning, the first match winning, an
  empty tool naming every menu, no null-menu check), `paintedApprovalOf` (6: no null check, hook state's `ask` winning,
  no subagent mark, the route dropped, the entry unreported, a bound of 17), `untrustedBuildItemOf` (8: THE KEY dropped,
  a read failure raising, no build to key by raising, a failed capture no fact, no action, another programme, a
  blocking item, any action read as the key) and `untrustedBuildItemsToSettle` (3).
- **The hook, 14 hand mutants, all killed** (`session-hook-approval-envelope.test.ts`): the plan's two (a main-thread event
  clears the list; a sibling's restore of `waitPrev` clears it), and any agent's event dropping every entry, its own events
  not dropping it, no add, the main thread adding, no bound, a SessionStart keeping it, the tie dropping nothing or
  everything, the list never read back, no route, a foreign stamp, and the route patch leaving the entry.
- **The readers, 22 hand mutants, all killed:** the hold (the entry's agent ignored, hook state's `ask` taken, the filter
  pinned to the main thread), the census (keyed by hook state's stamp and thread, hook state's `ask` taken, its own row
  matched by thread), the reader (the list never read, and seven entry guards: id, tool, summary length, stamp, route,
  a bad entry condemning the file, the summary bound), the stream (hook state's `ask` sent, the list unread), the wire
  (the mark dropped), the raise (no item, THE KEY ignored at the store), the capture lane (no settle) and the console
  (no subagent line; every approval saying it).
- **Red first:** the hook suite ran 14 of 17 cases red against the unchanged hook before the hook change (the three green
  ones assert an absence), and each reader suite's mutants above stand in for its red run.

## For the ledger

- `typecheck-tests` reddened three times on this branch with the test slice's memory cap killing `tsc` (2 to 10 OOM kills
  a run, `MemoryMax=6G`); once the one real type error was fixed, the file passed whole, alone. Measured, not fixed: the
  cap and the file's concurrency are not this PR's.
- The first CI run reddened `mail-routes.test.ts`'s kebab scan of `server/src/coord`: `untrustedBuildItem.ts` quotes three
  `BuildUntrustedReason` words, which no admission named. They are admitted through L0's `BUILD_UNTRUSTED_REASONS`, as
  every other lane's words are. That suite was not among the ones run before the push.
- Horkos's `rules-mixed` names `ccd/session-hook.sh`: a PR that changes a rules file may change nothing else. The brief
  puts the hook and its readers in one PR, so the split is left to the coordinator.
