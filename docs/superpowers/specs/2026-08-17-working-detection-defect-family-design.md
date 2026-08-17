# A busy workspace says it is busy — the archive marker stops outranking the pane, and two observers arbitrate

**Status:** SHIPPED-IN-PART 2026-08-17. §3 (D-74/D-75) and §4 (D-76/D-77) are implemented, tested
and verified against the live fleet on this branch; §5 is a ranked backlog, none of it written.
Baseline `5d54c97` on `main`, which `/health` confirmed as the deployed sha. Fleet measurements were
taken against the live `~/.cc-sessions`, `~/.claude*` and `http://203.0.113.7:7788/api/fleet` on
2026-08-17 between 13:29 and 18:55 UTC; every one is reproducible with the commands quoted beside
it. Bundle claims were verified by grepping the shipped
`~/.local/share/claude/versions/2.1.233` binary directly, not from documentation.

**Inherits:** `2026-08-10-architecture-ddd-clean-solid.md` (rings; the cross-cutting rules *no
overloaded null at a seam* and *an adapter may not narrow a distinction it received*, both of which
this defect family is a case study in).

## 0. What this is, in one paragraph

The operator reported that workspaces which are working and busy are "often not identified correctly
as such". They were right, and it was not one bug. A quarter of the live fleet was filed under
`cleanup` — rendered with the word **`merged`**, ranked *below idle*, and counted out of its
project's busy total — while mid-turn, because the bucket ladder tested an archive marker that ccd
never clears on a revive. Underneath that sat a second, opposite failure: Claude Code's own live
status file wedges on `"shell"` when a turn ends on a Bash call, holding a finished session in
`working` indefinitely (measured: 1 h 55 m on one session, reproduced independently on a second the
same afternoon). Underneath *that*, a third: the file has grown a fourth status word, `waiting`,
which ccrc had never heard of and laundered into `busy`, so a session blocked on a human read as
working. The repair is one conjunct, one arbitration rule, and one parsed field — 12 lines of logic
across two files, no wire change, no new bucket token.

## 1. What was measured

All three probes are read-only and were run on the fleet host (`openclaw`), which owns
`~/.cc-sessions`, the tmux sessions and the five wrapper HOMEs.

### 1.1 A quarter of the fleet was misfiled

```
curl -s http://203.0.113.7:7788/api/fleet \
  | jq -r '.sessions[] | [.id,.status,(.hookState//"-"),.bucket] | @tsv'
```

| id | status | hookState | bucket | verdict |
| --- | --- | --- | --- | --- |
| `ccrc-pwa-calm-mesa` | busy | working | **cleanup** | wrong |
| `custom-tools-brisk-ridge` | busy | working | **cleanup** | wrong |
| `expoAI-assistant-warm-mesa` | busy | working | **cleanup** | wrong |
| `data-internal-still-prairie` | busy | done | **cleanup** | wrong |
| `data-internal-plain-harbor` | idle | – | **cleanup** | wrong |
| `claude-corp-data-internal` | busy | – | working | wrong, the other way |

Five of the box's **seven** archive markers sat on sessions with a live tmux pane; four of those
panes were mid-turn:

```
for f in ~/.cc-sessions/*.archived; do id=$(basename "$f" .archived)
  tmux has-session -t "=cc-$id" 2>/dev/null && echo "$id  archived $(( ($(date +%s) - $(cat $f)) / 86400 ))d ago"
done
```

The oldest had carried its marker for **12 days**. `ccrc-pwa-calm-mesa` recorded
`archivedreason=merged:#28` beside `prnumber=34` — the workspace had been archived on one merge and
then reused for six further days of work.

### 1.2 The live status file wedges, and it is not a one-off

`claude-corp-data-internal` held `"status":"shell"` with `statusUpdatedAt` **6 480 s** stale, while
its hookstate recorded `state:"done"` written **5.7 s after** the live file's last write — the turn
demonstrably ended, and Claude Code never wrote the transition back. Forty samples at 15 s intervals
found `expoAI-assistant-warm-mesa` reproducing the identical signature (`shell`, hook `done` +5.7 s)
during the same run. Ninety seconds of 1 Hz sampling over eight busy sessions produced **zero**
idle↔busy transitions, so this is a stuck value, not flapping.

The trigger is ordinary: a turn whose last tool call was a Bash — including every
`run_in_background` and every `until … sleep` poll, which are normal ccrc workflows.

### 1.3 Claude Code writes a fourth status

```
grep -ao 'status:"waiting"[^}]\{0,60\}' ~/.local/share/claude/versions/2.1.233
  → status:"waiting",waitingFor:t,working:!1
```

`aTw` supplies the reason: `sandboxHostPrompt` / `workerSandboxPrompt` → `"sandbox request"`,
`elicitationPrompt` → `"input needed"`, `managedSettingsSecurityPrompt` → `"dialog open"`, else the
top dialog's own `waitingFor`. Claude Code states `working: false` explicitly. All five trigger
names are present in the 2.1.229–2.1.233 bundles on this box, so the introduction point predates
every version the fleet runs.

## 2. Why each one reached the wire

**The ladder's premise was true when written and is false now.** `sessionBucket`
(`shared/api.ts`) tested `archivedAt !== null` *first*, ahead of `dead`, `attention` and `working`.
That ordering is deliberate and correct — `ws-archive` stops the session, so every cleanup candidate
is also dead, and a dead-first ladder would leave the cleanup bucket permanently empty. What was
never enforced is the premise itself. `cmd_ws_archive` kills the pane before it stamps
(`ccd:2178-2185`), but of the five paths that bring a session back — `cmd_start`, `cmd_ensure`,
`_spawn`, `cmd_supervise`, `cmd_swap`'s tail — **none** touches `$REG/<id>.archived`. They clear
`.stopped` and `.swapblocked`, deliberately and with comments explaining why a deliberate revival
supersedes them; the archive marker was simply never in that list. Only `ws-restore` removes it
(`ccd:2513`), and the PWA's first, always-visible control on such a row is Restart, not Restore.

The premise lived in three comments and no mechanism. No test asserted `archived ⇒ dead`; worse,
two tests in `fleetstate.test.ts` *pinned the bug*, asserting that a snapshot carrying
`status:'busy'` **and** `archivedAt` revives as `cleanup`.

**Only one of the two observers could say `working`.** The ladder's working rung read `status`, and
`status` comes solely from `sessions/<pid>.json`. The hook — which fires on every tool call and is
the source the README calls primary — could say `working` and be read by no rung at all. So every
way the live file fails (wedged, absent, unreadable, behind an unknown wrapper, or blind to a
session waiting on subagents) produced an affirmative *not working*, with the fresher, contradicting
observation sitting unused on the same record.

**The one adapter that had the reason threw it away.** `liveSessionStatus` must answer in ccrc's
two-value vocabulary, so it cannot carry `waiting`. That is fine — what was not fine is that
`readLiveState` discarded `waitingFor` too, leaving no layer holding the distinction. Three of the
four causes paint no numbered menu for the pane scraper and fire no hook event, so nothing else
could recover it.

**And one polarity was inverted four lines from its own argument.** `liveSessionStatus` spends a
paragraph arguing an unrecognised status "is far likelier to be new work than new rest" — while
`String(raw.status ?? 'idle')` handed the single value that reads as *rest* to the case with no
evidence at all.

## 3. What shipped — D-74 and D-75

**D-74 — the archived rungs gain a liveness conjunct.** `if (s.archivedAt !== null && s.status ===
'dead')`. `status === 'dead'` is exactly "no tmux pane" as this ladder's callers compute it, so
there is no new field, no wire change and no second liveness derivation. A live pane is not evidence
that the archive was undone; it is evidence that the marker no longer describes this session.
`archivedAt` still rides the wire untouched, so `/archive`, `ws-attic` and the reap flow all find
the workspace exactly as before — the bucket answers *what is this session doing*, `archivedAt`
answers *what is staged on disk*, and a revived workspace is honestly both.

**D-75 — two observers, and the fresher one decides.** `hookNewer` compares `hookUpdatedAt` against
`statusUpdatedAt`. A newer hook `done` unseats a stale `busy`; a newer hook `working` raises a stale
or absent `idle`. Two exclusions carry their own reasoning: `SessionStart`'s synthetic write is
never evidence a turn *ended* (it proves "never started" — the same carve-out the `done` rung
already makes), and a null `hookUpdatedAt` reads as "not newer", which leaves `reviveFleetSession`'s
cached-snapshot path on exactly its pre-D-75 answers. `status` itself is untouched: still frozen,
still hook-blind, and `fleet.test.ts`'s freeze test still passes unmodified.

D-75 covers the Workflow-orchestrator case as a free consequence, and more reliably than the pane
scrape it supplements: `session-hook.sh` refreshes `updatedAt` on every `SubagentStart`/`SubagentStop`
while carrying the previous state, so an orchestrator idle-waiting on subagents keeps a hook
`working` newer than its idle `statusUpdatedAt`.

## 4. What shipped — D-76 and D-77

**D-76 — `waiting` reaches the attention bucket, and brings its reason.** `readLiveState` parses
`waitingFor`; `assembleFleet` ORs `live.status === 'waiting'` into `dialogPending` and falls back to
`waitingFor` for `askSummary` when no hook envelope exists. `liveSessionStatus`'s collapse to `busy`
is **unchanged and now pinned by a test**, because three consumers read `SessionStatus` to answer
"may I act on this session right now" — the mail delivery gate, the archive-safety verdict and the
per-session socket — and for all three a human-blocked session must read hands-off. Answering
`idle` there would let mail inject into an open dialog and let auto-archive kill a session sitting
on a permission prompt.

**D-77 — the no-status file stops reading as rest.** `String(raw.status ?? '')`. `''` is not
`'idle'`, so the two functions now agree, and D-75's arbitration corrects the answer whenever the
hook has something fresher to say.

### 4.1 Verification

`readLiveState` had **zero** direct tests before this work; `livestate.test.ts` is its first
coverage, and the absence is why a new status word survived several releases unnoticed. Every guard
was measured red-on-deletion rather than asserted to be tested:

| mutation | tests that go red |
| --- | --- |
| drop `&& s.status === 'dead'` | 4 |
| drop `!finishedAfterStatus` | 1 |
| drop the hook-raised working rung | 2 |
| drop the `SessionStart` exclusion | 1 |
| make a null `statusUpdatedAt` lose | 1 |

Suites: server 125 files / 2 930 tests, agent 18 / 267, pwa 59 / 1 539 + typecheck — all green.
Two `fleetstate.test.ts` cases were changed deliberately: they pinned the bug on a fixture whose
`status` was `'busy'` beside an `archivedAt`, which is the exact contradiction D-74 resolves; a
third case was added asserting the busy-archived snapshot now revives as `working`, because the
ladder's two producers must not be able to disagree.

Finally, the fixed `assembleFleet` was run against the **real** registry and compared row-by-row
with the deployed server: **6 of 22 rows change bucket**, all toward their honest live state; the
two genuinely dead-and-archived rows keep `cleanup`/`archived`, so the bucket is not emptied; and
`archivedAt` still ships for all seven rows that have one.

## 5. Not shipped — the ranked backlog

Findings below survived adversarial verification but are **not** implemented. Ordered by measured
impact × frequency.

**5.1 The exec/read seam launders "nobody answered" into "not working".** Every transport failure —
a dropped agent read, a tmux client killed at its 10 s ceiling, a mid-reconnect socket — collapses
into the same `null` that means *file absent*, and `assembleFleet` reads that as `status: 'idle'`
(or `'dead'`, from a failed `has-session`) with nothing on the record to say the row was never
measured. `server/src/io.ts`'s `// null = missing` is already flagged in `CLAUDE.md` as false. Not
observed at rest (0 of 12 whole-fleet assemblies, ~6 400 round trips) but silent when it fires: no
log line, no wire field, no bucket difference. **Sharp edge for whoever takes this:** the dominant
tmux failure is an agent-side signal kill, which mints `code:1` with *empty stdout and stderr* and
returns as an `ok:true` frame — sniffing stderr server-side would miss it entirely. The tag has to
be minted in `agent/src/fileops.ts` and `agent/src/server.ts`, which makes this **AGENT-FIRST**.

**5.2 `workflowActive` is erased by a wholesale replace.** `watch.ts`'s statusline retention gates
on `if (sl.model || sl.branch || sl.effort)` and then *replaces* the stored object;
`workflowActive` is not in that disjunction, so a tick that parses a statusline but no `N/M agents
done` line clears the flag. A capture that returns `null` deletes the entry outright, and a timed-out
capture is indistinguishable from a dead pane. Lower priority than it looks, because D-75's
subagent-refresh path now covers the orchestrator case independently — **and note that a naive
"merge, never clear" fix would wedge a session in `working` after its workflow ended.**

**5.3 ccd's marker outlives the revive — and clearing it is a session-killer.** The disk-level twin
of D-74. It is tempting to have `cmd_start`/`cmd_ensure` clear `$REG/<id>.archived` the way they
clear `.stopped`. **Do not do this as a display fix.** `archiveMerged` skips on `r.archivedAt !==
null`, so the stale marker is currently the *only* thing suppressing a level-triggered re-archive of
those five rows; clearing it hands them to a sweep that stops the session and kills the pane the
moment `archiveSafety` reads not-busy — which, between turns, is seconds away. Any fix here has to
settle what a revived-from-archive workspace *is* first (does the old merged PR still bind it?), and
`ws-hold` is the existing protection. Consequence of leaving it: `cmd_ws_hold` refuses on these
rows, so a revived workspace cannot be claimed by a program until someone runs `ws-restore`.

**5.4 The actions sheet offers `Clean up workspace…` on a live, busy session.** It gates on
`archivedAt !== null`, faithfully mirroring ccd's own `ws-reap` refusal, so it is not wrong on its
own terms — but before D-74 the row beside that button read *"merged, ready to clean up"*, which is
an operator being invited to destroy a running session's uncommitted work. D-74 removes the
misleading label; the button placement is a product decision left open deliberately.

**5.5 `sweepHookStates` erases hook state on one dropped read**, which now matters more than it did:
post-D-75 the hook is load-bearing for the working bucket, so a dropped read costs a live signal
rather than just an ask envelope.

**5.6 No application-level heartbeat on `/ws/fleet`.** A silently-dropped browser socket freezes the
whole fleet at its last buckets with `conn === 'open'` and no banner, and foregrounding the app does
not recover it. Every bucket on screen is then arbitrarily stale — the most complete way to be
"not identified correctly" of anything in this document.

**5.7 `panePid` trusts the first pane of the tmux session's current window.** A second window or a
`split-window -b` moves it off the claude process permanently, and the terminal drawer attaches to
these panes routinely. Zero occurrences today (20/20 sessions have `pane_pid == claude pid`), but
when it fires the row reads idle for hours. Related: `readLiveState` discards the `tmux` and
`procStart` identity fields the file itself carries, so a pid is trusted with no proof it is the
right process — the opposite of the discipline `readHookState` applies. Measured pid churn gives a
full wraparound every ~2.7 h against sessions that live for days.

**5.8 `GET /api/fleet` takes its own whole-fleet assembly** — 1.05–1.37 s and ~536 agent round trips
per request, unshared with the 2 s tick. A permanent 60 %+ tax on the agent link whenever the PWA is
open, which makes every drop-based failure above more likely.

## 6. The residual this design does not close

A wedged live status file whose hook has *also* gone quiet for over 30 minutes reads `working`
again, because `HOOKSTATE_FRESH_MS` nulls `hookState` and takes the contradicting timestamp with
it. The evidence survives on disk — the hookstate file still records `state:"done"` at a time later
than the live file's last write — but `readHookState` collapses stale into the same `null` as
missing, malformed and uuid-skewed.

Closing it means letting staleness be a *distinction* rather than a seventh collapse into `null`,
which changes a contract with four consumers including the mail delivery gate's `hs === null`
conjunct. That is a coordination-invariant change and deliberately out of scope here. Left as-is,
one session in twenty sat wrong for 1 h 55 m; the direction is a false *positive*, which is the
safer of the two, and it self-heals on the session's next turn.

## 7. Rules this work is a case study in

Both cross-cutting rules from the architecture doc earned their keep here, in the same afternoon:

- *No overloaded null at a seam.* Four of the defects above are one `null` standing for two
  conditions a caller handles differently — read-failed vs absent, stale vs missing, unknown-status
  vs idle, unmeasured vs not-working.
- *An adapter may not narrow a distinction it received.* `readLiveState` was handed `waitingFor` and
  dropped it; `liveSessionStatus` could not have recovered it afterwards.

And one rule this defect family argues for adding: **a comment asserting a precondition is not a
precondition.** `archived ⇒ dead` was stated in three places, believed by the ladder, and false in
production for twelve days. It is now a conjunct with four tests behind it.
