# The wave lifecycle: step 2, dispatch a wave

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## 2 — Dispatch a wave

`POST /api/runs/:id/dispatch`
`{"brief":"<the wave brief, prose>","items":["<title>", …],"route":{"class":"…","effort":"…","subagent":"…","workflow":"…","compact":"…","browser":"on"},"slug":"<child name>"}`
→ `{"ok":true,"id":<run id>,"sessionId":…,"resumed":…,"clearedAt":…,"briefQueued":…}`
with the run now `dispatched`, or a refusal:


| refused | what it means | what you do |
|---|---|---|
| `paused` | `$REG/coordinator-paused` exists | stop, report, touch nothing |
| `mail-disabled` | `$REG/mail-disabled` exists | stop, report, touch nothing |
| `cap-concurrency` | `maxConcurrentWorkers` is full | stop, name the cap, wait |
| `ambiguous-dispatch` | wave 1's spawn found 0 or >1 candidate workspaces | stop and report; the operator resolves it |
| `worker-busy` | wave ≥ 2's session is observably mid-turn — at the gate, or at the act: the server reads the live file again just before the `/clear`, and a refusal there can leave this run's own hold and route arming in place, which the next dispatch rewrites (D-5238) | wait and retry; do not force it |
| `hookstate-unmeasurable` | wave ≥ 2's session has a hookstate file the server could not READ — so whether it is mid-turn was never measured at all | retry once: nothing was spawned, the run is untouched and still `planned`, and the workspace was only resumed. If it repeats, stop and report — a file on the fleet host needs a human, and this refusal will stand until it is readable |
| `status-unmeasurable` | wave ≥ 2's session's LIVE file (or its pane) could not be read before the `/clear`, so whether it is mid-turn was never measured — the hookstate can say `done` while the pane works, so the server also reads the live file (D-5238) | the same rule as `hookstate-unmeasurable`: retry once (the run is untouched, still `planned`, the workspace only resumed — read again just before the `/clear`, it can also refuse at the act, after this run's own hold and route arming were placed, both of which the next dispatch rewrites); if it repeats, stop and report |
| `worker-starting` | the pane THIS dispatch's `ensure` started had not come up within the server's bounded wait | send the dispatch again: nothing was held, cleared or sent and the run is untouched. This is the only way a spawn slower than the wait completes |
| `project-mismatch` | wave ≥ 2's session has a registry row whose `.project` was READ and names ANOTHER project than this run's; `by` names the project that was read. A row whose `.project` cannot be read answers `registry-unmeasurable` instead — take that code by its OWN row below (stop and report; never a blind retry): its wire shape is identical to the one a killed `ws-add` can send, so you cannot tell from the response which rung answered. A row with no `.project` at all is not refused | stop and report. Nothing was spawned, no `/clear` was sent, and the run is untouched and still `planned` — but the OPEN that named this `sessionId` placed a hold on that workspace, a worktree in the wrong repo, and it is still standing. Do not retry this dispatch, and do not simply open the wave again without `sessionId`: an open of the same still-`planned` wave returns the SAME run, still bound to the crossing session, and the next dispatch refuses identically. The operator must abandon the wedged run from the console; only after the operator reports it abandoned do you open the wave again WITHOUT `sessionId` so it spawns fresh in the target repo |
| `workspace-spent` | wave ≥ 2's session is a CHILD whose branch has had a PR since this run was opened — usually the previous wave's worker opened it after you opened this wave on its workspace; `pr` names it. The body also carries `unbound`, and `detail` whenever `unbound` is `false` | `unbound:true`: the server has already released the workspace (or handed its claim to the other run still open on it), cleared this run's `sessionId` and left the run `planned` — dispatch it again, unchanged, and a fresh child is minted, branching from the project's default branch and carrying none of the spent producer's unmerged commits; if this wave depends on that producer's code, wait until its PR is proven merged, exactly as §5's "One PR per child" requires, before dispatching again. `unbound:false`: that release (or hand-over) did not happen, or it happened but the run was no longer `planned` and bound by the time it completed — `detail` says which; a `detail` naming a PERMANENT cause — this box's ccd "does not support" the verb, the surviving run's claim "cannot be written", or the other runs naming the workspace "could not be read" — means stop and report, and any other `detail` (including "`<verb> failed`") means retry the same dispatch once, and if it repeats, stop and report. Either way nothing was resumed and no `/clear` was sent |
| `spent-unmeasured` | wave ≥ 2's session may be a spent child and the evidence could not be read; `detail` says which read failed. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY session, marked or not — where a resume used to answer `error: 'registry-unmeasurable'` — because without the listing the server cannot tell a child from any other workspace; but dispatch lists the registry for its own pause check FIRST, so a registry that is ALREADY unlistable there answers `paused` instead (the table's first row) and never reaches here — this code's unlistable case is a listing that fails only at the resume arm's own re-read, after that pause check's listing already succeeded. `unbound` is always `false` | retry the same dispatch: the binding is kept, nothing was resumed and no `/clear` was sent. It is not `workspace-spent`. If it repeats, stop and report |
| `intent-held` | another programme's run in this project holds a landing intent this dispatch names, and is not `done` or `failed`; `key` names the intent and `holder` the run and its programme | stop. Nothing was spawned by this attempt and the run is still `planned`, except that on the `worker-starting` re-run the first pass may already have started or woken the bound worker's pane; no hold or row is written. Mail that run's coordinator, naming the key, through its `runId`, and report it in your turn. Dispatch again without the key only once that coordinator or the operator says the two waves are not the same change. Never retry it unchanged |

A dispatch may carry `intents`, an array of at most 8 keys, each the issue or
PR number its wave answers (`#<n>`) or a deviation number (`D-<n>`). Name one
when another programme could take the same change. A landing intent stays held
until your run is `done` or `failed`, your own later waves never trip it, and a
review run names none. The `200` names the keys it took in `intents`; a `200`
with no `intents` field came from a server older than 5g, which took no hold,
so say so in your turn.

**Caps count ACTIVE runs, not holds and not merely non-terminal ones.**
Concurrency counts dispatched runs whose state is ACTIVE — `dispatched`,
`working`, `unknown` — so a terminal producer retained on a hold, a planned
undispatched consumer, and a run parked IDLE at `awaiting-review`, `merging` or
`closing` all consume no running-worker slot. **An idle run gives its slot back
WITHOUT closing** (D-2803); before wave 6 of review-runs it held one until it
reached a terminal state, and prose written against that older rule is wrong
rather than merely imprecise. A dispatched run consumes one concurrency slot
for as long as it stays active, and that is the only cap: there is no daily
dispatch count, so a review or a warm resume costs nothing beyond its slot.
The refusal's own numbers are the authority: `cap-concurrency` carries `limit`
and `running`.

**`worker-busy` and `hookstate-unmeasurable` are not two words for one
answer.** `worker-busy` is a MEASUREMENT: the server read the session's
hookstate and it says a turn is running, so waiting is exactly right — the
turn ends on its own and the next dispatch goes through.
`hookstate-unmeasurable` is the ABSENCE of that measurement: the file is
there, the read failed, and the server knows nothing about the session's turn
— so it refuses rather than inject `/clear` into a pane that might be
mid-turn and discard a real context. Waiting cannot resolve it, because
nothing about the fleet is going to change on its own. (It is also not
`registry-unmeasurable`, whose "never a blind retry" rule exists because THAT
refusal can land after `ccd ws-add` already spawned a workspace. This one
lands after a plain resume: nothing was minted, so nothing can be stranded.)

#### An `ok:true` dispatch is no longer proof that the pane is ready

`POST /api/runs/:id/dispatch` answers with three fields beyond the ones above:

| field | meaning |
|---|---|
| `adopted` | `true` when the workspace was **adopted from a killed `ws-add`**, not created by a clean one. The HTTP call that made it timed out and the server killed `ccd`; the workspace, the claim and the supervisor all exist, but nothing confirmed the session's TUI came up. |
| `spawnState` | how the last spawn attempt ended: `ready`, `login`, `vanished`, `expired`, `blocked`, `narrow`, `unrecognised`, or `null` for *not recorded*. `null` is not `ready` and is not a warning — it means no spawn fact was written. |
| `skillState` | whether the worker session this dispatch bound has the `ccrc-worker` skill installed on the home it is running from: `present`, `absent`, or `unmeasurable`. MEASURED at dispatch, and never a refusal — the preflight never refuses a dispatch, so an `absent` dispatch is a real dispatch. `unmeasurable` is not `absent`: it means no answer was obtained, so nothing was proven about the fleet either way. Three ways that happens — this box's roster does not carry that account; the session has no registry row, so there is no account to look under and no read is attempted; or the read itself would not complete. |

**What to do with them.** On `adopted: true`, or on any `spawnState` other than `ready` or `null`,
**do not treat the brief as delivered**. Wait for the worker's first mail as usual, but if none
arrives within the wave's ordinary window, read the session's own screen before re-dispatching:

- `spawnState: 'expired'` — the settle ran out. Large resumes legitimately settle unconfirmed; the
  session is very often fine. Give it the ordinary window before acting.
- `spawnState: 'login'` or `'blocked'` — the account behind that lane needs a human. Waiting longer
  cannot fix it. Say so to the operator; do not re-dispatch onto the same lane.
- `spawnState: 'vanished'` — the tmux session went away mid-poll. The row will classify itself on
  the next sweep.
- `spawnState: 'narrow'` — the pane was under 120 columns (`READER_MIN_COLS`) when it spawned, or
  ccd could not read its width, so ccd answered none of its startup prompts, skipped its `/effort`
  and its re-drive of an interrupted turn, and keeps its pane readers stood down while it stays
  narrow. The server's mail lane is not width-aware: it still types into this pane, and cannot see
  an armed auto-continue whose line has wrapped. Waiting does not fix it. Ask the operator to widen
  it (opening and closing its terminal drawer re-pins it) and to check its screen for an unanswered
  startup prompt before you re-dispatch. A current ccd pins every spawn 220x50, so the usual cause is
  a terminal attached to that session itself (a marker from an older ccd may mean one on any session).
- `skillState: 'absent'` — the worker will read your brief without its standing protocol, because
  the skill installer has not run on that account's home. The dispatch still happened and the brief
  still works, degraded: it carries the branch-discipline sentence in its own text for exactly this
  case. **Report it to the operator before you treat the wave as briefed** — running the installer
  is a human act, and every later wave on that home has the same gap until it happens.
- `skillState: 'unmeasurable'` — say so as an unknown, not as a problem. Nothing was measured, so
  do not go hunting for a missing install and do not re-dispatch: the wave is briefed either way.

`adopted: true` is also written to the run's event trail as `spawn-adopted:<spawnState>`, so the
provenance of the workspace survives the conversation. Every dispatch also writes its preflight
there as `skill-preflight:<skillState>` — on all three answers, so a trail with no such line means
an older build, never a healthy home.

**`slug` — the child's name, chosen at birth.** `"slug"` is an optional
WORKSPACE slug — not the programme slug of §1, which has its own grammar — for a
fresh spawn only. It rides to `ws-add`, so the worktree, its `ws/<slug>` branch and
the session id `<project>-<slug>` carry it from the first second; use it when the
work keys on the workspace name (a ticket id, say). Nothing renames a child later:
the path and the session id never move, and the branch-only `ws-rename` refuses a
held workspace. It follows ccd's own slug grammar (`_ws_slug_valid`); a malformed one
answers `error:'bad-request'` (400) with a `detail` reading `slug: must match …`, and
a slug on a run that resumes its bound session answers 400 with `slug: this run
resumes …` — drop it there, it names nothing. A named spawn binds ONLY
`<project>-<slug>`: any other new workspace is never adopted in its place. A slug
already in use — or one whose id outruns ccd's length cap with a long project
name — fails the spawn with a 502 whose `stderr` carries ccd's own words: choose
another name, never retry the same one. **Check the answer's `sessionId` equals
`<project>-<slug>`**; an older server ignores the field and mints a random name, and
that mismatch is a stop-and-report, not a retry.

**`items` — the wave's declared ledger.** `"items"` is the machine-readable
half of the wave plan whose other half is the brief: one title per unit of
work, at most **32** of them, each at most **200 UTF-8 bytes** (bytes, not
characters — a title of emoji or CJK hits the cap sooner than its length
suggests). The brief stays prose the server never reads; these titles are what
the run board counts, so **the two must agree** — a brief that names five
units of work beside three items renders a tally that lies. A malformed
`items` (not an array, an entry that is not a non-empty string, past either
cap) answers `error:'bad-request'` (400) before anything is listed, spawned or
held: the run is untouched, still `planned`. Omitting `items`, or sending
`[]`, is legal and means this wave declared no ledger — the board renders `—`
rather than `0/0`.

**`route` — the wave's placement, not a request.** `"route"` is an optional
object of the SIX writable fields — `class`, `effort`, `subagent`,
`workflow`, `compact`, `browser` — whose vocabularies `references/routing-matrix.md`
spells out; that matrix is what you derive it from (clause 13), never a
taste call made at dispatch time. The server carries it to `ccd`: on wave
1's `ws-add` argv for a fresh spawn, and for wave N ≥ 2 — a resumed
workspace, never a fresh one — through the routing verb instead, as ONE
argv carrying every pair (validated together before anything is written),
placed after the hold and before the `/clear`. An old `ccd` that cannot
take it is never blocked on: the server journals the omission instead and
moves on, as `route-omitted:no-route-argv-cap` (wave 1's argv path) or
`route-omitted:no-route-v1-cap` (wave N ≥ 2's verb path) — two DIFFERENT
run events because the two are different parse paths that can ship one
without the other. Omitting `route` on a fresh spawn fills the run
kind's default row from `shared/route-defaults.ts` (the matrix's spec'd-worker
row for `work`, the review-session row for `review`) and journals
`route-defaulted:<kind>`. The default's class is a PREFERENCE, never a
requirement: the server sends it with `--route-default`, so ccd places by it
like the coordinator row's own default, and a project whose in-pool lanes are all
at the seven-day ceiling still places a defaulted dispatch (a class YOU pass is
strict and is refused at the ceiling, `no account available for placement`). A
ccd without `route-default-v1` gets no default route at all and the server
journals `route-omitted:no-route-default-cap`; a resumed wave with no `route` keeps its session's
record; an empty `{}` is a passed route and is sent bare. The brief still names the routing in prose (clause 13) — this
object is what carries that placement to the fleet, never a replacement
for saying so.

**`browser` — dispatch with `browser=on` when the task needs a browser** (D-8121). Fleet sessions start no browser
MCP server (Playwright, Chrome DevTools) unless they ask for one: the box default is off. A wave whose work drives a
browser — a UI check at three widths, a browser-leg test, a page to read through the browser tools — carries
`"browser":"on"` in its route; every other wave leaves the field out (`off` is only for a box whose default is on).
`browser` is not a routing answer: on a fresh worker, a route that names ONLY `browser` keeps its run kind's default row
and that row's preference placement, with `browser` laid over it, so `{"browser":"on"}` alone is the usual spelling. A
route that names `browser` beside any other field is a passed route like any other and replaces the row, so name every
field you want with it. It applies at the worker's spawn, so a resumed wave N ≥ 2 that newly needs one takes it at that worker's next start, never
mid-run. A ccd without `browser-route-v1` gets the rest of the route and the server journals
`route-omitted:no-browser-route-cap`. A session that finds it needs a browser may turn its own on with
`ccd route --session <own id> --set browser=on`; it applies at its next restart.

**`child-omitted:no-child-argv-cap` — a fresh workspace that is not a
child.** Every workspace a fresh dispatch mints is a CHILD of its run: the
server sends `--child <run id>` on the `ws-add` argv and `ccd` records it as
the workspace's child marker before the first launch. A box whose `ccd`
predates the `child-argv-v1` capability cannot parse that flag, so the
server omits it and journals `child-omitted:no-child-argv-cap` on the run —
on EVERY fresh dispatch to that box, not only when you asked for something,
unlike the two `route-omitted` events. The same event also records a
dispatch the server could not measure: it held no capability list for the
box — the local-mode boot window, a failed local caps probe unmeasured
until the server restarts, or a remote ready frame with no usable list.
Each cause has its own remedy. The local-mode boot window clears on its
own, within seconds, once the box's one bounded boot-time probe resolves;
a remote ready frame with no usable list clears the same way with no
action from you, inside about a minute, on the watcher's own 60 s caps
lane, which re-asks regardless of what the last frame said. A failed
local caps probe does not retry itself — only a server restart re-probes
it. An agent whose caps stay list-less past that 60 s lane needs its ccd
or the agent process itself looked at. `ccd caps` run on the box tells
the old-ccd cause apart from all of these: a list already naming
`child-argv-v1` means the box's ccd is fine and the fix is one of the
remedies just given, never a ccd deploy. A `ccd caps` that fails outright
is NOT evidence of an old ccd — the same top-level check that kills every
other invocation on a broken box (a missing or unreadable
`~/.ccrc/accounts.sh`, `ccd/ccd`'s own `die`) kills `ccd caps` before it
ever reaches its capability list, so a failing `ccd caps` gets the "look
at its ccd" remedy above, plus a server restart afterward on a local box
to re-probe it. Only a list that omits `child-argv-v1` outright names the
old-ccd cause, and a ccd deploy is its fix. The event itself is not an
error and asks nothing of you: that workspace is simply not a child,
exactly like every workspace
minted before the token existed, and nothing will ever reclaim it as one. A
resumed workspace mints nothing and never carries the row.

**The ledger is fixed at dispatch.** No route adds an item to a dispatched
run, so `total` never grows and the tally can never move backwards. Work
discovered mid-wave is a note in the wave-done mail and an item in the NEXT
wave's brief — that is what waves are for.

`unknown-run` (404) means the run id is wrong or the DB was rebuilt — re-read
`GET /api/runs`. `bad-transition` (409) means this run is not `planned` —
someone already dispatched it, or it is further along than you think.

**Answers that do NOT ride `refused`.** The table below is what SKILL.md
calls "the refusals you will actually meet" — but this route (and `POST
/api/runs/:id/close`) can answer six other shapes, and blindly retrying any
of them is how a workspace gets orphaned:

| shape | meaning | what you do |
|---|---|---|
| `error:'oversize'` (413) | the mail this dispatch would queue — the worker kickoff prefix **plus** your brief, composed — exceeds the mail body byte cap (`MAIL_BODY_MAX_BYTES`). Checked EARLY, before the pause/kill-switch check, before caps, before anything is spawned or held (`dispatch.ts`'s own `MAIL_BODY_MAX_BYTES` check). Not a mail-routes-only code: this is the SAME field/status `POST /api/mail`'s own oversize body/subject/artifacts refusals use (SKILL.md), but this occurrence is dispatch's own | trim the brief and resend — the run is untouched, still `planned`, and nothing on the fleet was spawned |
| `error:'hold-oversize'` (413) | the persisted run's complete session-card hold exceeds the hook's 127-character display window. Rechecked here for reconstructed or newer-database rows that bypassed current open-time validation | shorten the programme slug through an operator correction before retrying. The run stays `planned`; no pause/cap read, spawn, ensure or hold occurs |
| `error:'hold-invalid'` (400) | the persisted run's programme or numeric fields cannot satisfy the hook's positive-decimal hold grammar | stop and report the stored defect. The run stays `planned`; no pause/cap read, spawn, ensure or hold occurs |
| `error:'registry-unmeasurable'` (502) | the fleet's registry directory could not be listed — and this can land AFTER `ccd ws-add` already ran, before the run row records the new workspace | **stop and report; the operator resolves it** — exactly like `ambiguous-dispatch`, never a blind retry. A retry's `before` snapshot now includes the orphaned workspace, so the retry binds a SECOND one and strands the first, unheld and unrecorded, on the fleet |
| `error:'unsupported'` (501) | this ccd build does not support a verb this route needs | stop and report — an operator/fleet-host issue, not a retryable one |
| a bare `{"ok":false,"stderr":"<text>"}`, no `refused`/`error`/`reject.code` field at all (502) | the underlying `ccd` call itself failed for one of its ordinary reasons — `ws-add` (wave 1's fresh spawn), `ensure` (wave ≥2's resume), or `ws-hold` (either wave, the claim itself) | stop and report — the SAME as the rows above, even though none of the three fields SKILL.md's own check reads is populated. `state` always stays `planned` (this shape never advances it) — but that is NOT "nothing happened yet": `sessionId` may already be WRITTEN onto the row (a wave-1 `ws-add` success writes it before `ws-hold` can go on to fail; wave ≥2 always starts with it already there, from an earlier open or dispatch), and a workspace may already exist on the fleet, freshly spawned and unheld. Confirm no partially-spawned or partially-held workspace was left behind by an earlier attempt before ANY retry — the fleet is where that evidence lives, not the run row's own `state` |

**A brief can be refused `oversize` without itself exceeding the cap.** What
dispatch measures is the COMPOSED mail — the worker kickoff prefix (the
sentence that sends the worker to its `ccrc-worker` skill; see "What a brief
carries" below) followed by your prose — so the cap bounds the envelope, not
the thing you are holding. Subtract the prefix to get the number that actually
binds you: the effective brief ceiling is **8090** bytes today
(`MAIL_BODY_MAX_BYTES` 8192 − the prefix's 102). The 413's `detail` spells the
same arithmetic out for the brief you actually sent — your brief's bytes, the
prefix's bytes, the cap — while the `limit` field beside it is the CAP, never
what your brief may weigh. Trim against the ceiling, not against `limit`.

`error:'bad-request'` (400) is also possible — a malformed request body —
covered where it actually bites on the ordinary path, §4 below.

For wave 1, this call is also where the workspace's hold actually lands
(reason `program:<slug> wave:1/M run:<id>` — see §1's own note on this). For wave ≥ 2,
this route itself resumes the held workspace and injects `/clear` through
the send path before it queues the brief — recording `resumed`/`clearedAt`
on the response. This session never sends `/clear` to a worker by any other
route (clause 9); dispatch is the one writer of that step, and a coordinator
that "helps" by clearing the pane itself is a second writer racing the
first.

**What a brief carries — and what it no longer has to.** The standing worker
protocol is a SKILL, not a paragraph you re-type every wave. Dispatch composes
the brief mail as `WORKER_KICKOFF_PREFIX` + your prose, and that prefix tells
the worker to run the `ccrc-worker` skill before it acts on anything below it;
the skill is where identity-on-every-call, ack-before-you-act, the
AskUserQuestion rule, the ban on the destructive verbs and the shape of a
done-claim's fingerprint already live, pinned by their own suite. Restating any
of that in a brief buys nothing and spends the one budget a brief is short of
(the `oversize` ceiling above). **A brief carries what only THIS wave knows:**
the plan file's path, the tasks or task range this wave owns, **the execution
skill the worker should invoke** (`superpowers:executing-plans` or
`superpowers:subagent-driven-development`), the interfaces earlier waves
settled, the deviations already ledgered, the shape of the wave and the
routing the matrix derives from it — class, effort, subagent class, workflow
mode, and the subagent effort the worker should name on its calls
(`references/routing-matrix.md`, clause 13) — and whatever the last review
run's report, and your ruling on it, decided.

**Every brief for a wave in ANOTHER project carries three immutable-plan
coordinates:** `homeRepoRoot`, the absolute path to the home repository root;
`planRepoPath`, the tracked repository-relative plan path under
`docs/superpowers/plans/`, with no leading slash; and `planSha`, the full 40-hex
plan commit SHA. These are separate from `ledgerAbsPath`, which names only
`docs/superpowers/programs/<slug>.md`. The worker reads the immutable plan object
exactly with
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`. If that repository, commit,
or path cannot be resolved, it reports and stops. It must not substitute `HEAD`,
directly read a mutable checkout as authority, fetch, checkout, or otherwise
mutate the home repository.

**Only a consumer with a producer-interface dependency carries the producer
contract:** `producerRepoRoot`, the absolute producer-repository root;
`producerSourceRepoPath`, the producer source file's repository-relative path;
`producerSha`, the exact full merged producer SHA; and the contract excerpt
inlined verbatim from the merged file. A foreign-repo wave with no such
dependency carries none of these producer fields and no invented excerpt. The
worker proves producer-source provenance with
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. If that
producer repository, commit, or path cannot be resolved, it reports and stops.
The inline excerpt controls dispatched interface shape; the immutable producer
blob proves its provenance; the plan blob at `planSha` controls wave scope and
requirements; and the current checkout's plan is not authoritative for this
dispatch. It commits only on its own workspace's branch in the repo it is
running in.

**The execution skill is the one list item that is not merely useful.** The
worker's own clause 6 reads "Invoke the execution skill the brief names rather
than improvising one" — it keys on YOUR brief, so a brief that names none
leaves that clause pointing at nothing and the worker improvising the very
thing the clause exists to stop. Name it explicitly, every wave, the same way
you name the plan file.

**A brief may quote the worker's graph card, where that workspace has one.** A
session whose tree carries `graphify-out/graph.json` gets one `SessionStart`
line for THAT tree: node count, the commit the graph was built at, and a
freshness clause. **CONTENT decides that clause first** (D-1368): a graph whose
built commit carries the same TREE as `HEAD` describes this workspace exactly,
so it reads `fresh` however the two commits stand to one another — a squash
merge or a rebase rewrites the commit and keeps every byte — and the card
APPENDS ` — same content as HEAD` when the built commit is not `HEAD` itself, a
qualifier on the state rather than a state of its own, so the one word is still
what you branch on. Only when the two trees DIFFER does ancestry decide, and
only there does the clause read `1 commit behind HEAD` / `N commits behind
HEAD`, `not an ancestor of HEAD`, or `freshness unmeasured` — the second when
the graph was built at a commit this tree cannot reach AND carrying different
content (a branch tip the session has since checked away from, or a genuinely
diverged branch), so the graph describes code the tree does not carry rather
than merely missing code it does, and the last when the graph names a commit
that git in that tree will not date, which is a different thing again from a
graph that is merely old. Every half is individually optional: whatever the hook could not
measure is simply left out, so a card with no freshness clause at all is a
fourth state and not a fault. A tree the sweep REFUSED gets a different and
equally quotable line — `this tree has no knowledge graph`, plus the sweep's own
last reason — and a tree the sweep has not reached gets NOTHING. A missing card
is never something to report as broken. Quoting the freshness half in the brief
tells the worker what it is querying before it queries it: a graph 97 commits
stale answers confidently and wrongly, and worker clause 12 turns anything but
`fresh` into a lead the worker must verify by reading the file. The card is
measured per tree, so a brief that quotes it is quoting THAT workspace, not the
fleet.

**One sentence from the protocol goes in every brief anyway: "commit on this
workspace's own branch; do not create or switch to a separate feature
branch."** (F5, build4 dogfood wave 1.) `ws-add` creates the workspace on its
own branch (`ws/<slug>`); §4's done-fingerprint re-measures THAT branch's tip
(`record.branch`, the live registry's own field), never a branch the brief
merely names. The ordinary per-PR SDD convention elsewhere in this codebase —
"cut a fresh `feat/<name>` branch from main" — is WRONG here: a worker that
follows it faithfully leaves the workspace branch unmoved, so every later
`/advance`/`/close` re-measures a tip that never changes and refuses
`stale-tip` forever, with no non-abandon path to close a run whose work is
otherwise correct and reviewed. The skill's own clause 2 says it; say it again
— belt and braces, deliberately, because a skill reaches a config dir only
once the installer has run against that home, and a worker dispatched onto a
home that has not had it has your brief and nothing else. This is not optional
phrasing left to judgement (clause 5's "the content is this session's
judgement" does not cover it) — it is the one sentence that keeps the wave
closeable at all.

**The workspace's name is frozen for the life of the claim.** This is a fact
the fleet did not previously guarantee, not a correction to anything above:
the automatic naming sweep used to rename a workspace to a slug of the
worker's first ai-title, typically within a minute of dispatch, whether or not
a program had claimed it. It no longer does — the sweep skips any row that is
held or that an open run names, and `ccd ws-rename` refuses a held workspace
outright. So the branch this run is dispatched on is the branch it still has
when you re-measure it, and a brief, a ledger entry or a review note may cite
the branch name and expect it to resolve. Releasing the hold (or closing every
run naming the session) un-freezes it, and the next sweep may rename it then.

**A brief for an opted-in project says so.** A brief for a project whose `$REG/landing/<project>/enabled` exists names
the opt-in and the radar's base. The worker's clause 9 exception and the reviewer's clause 3 exception apply only
where the brief says so, and a brief for any other project says nothing of them. Name the base in that brief as a
ref name, `origin/<base>`, where `<base>` is the PR's base branch (`gh pr view <n> --json baseRefName`), and never as
a sha. Before a PR exists, as in a first worker brief, `<base>` is the repository's default branch, read as a ref name
with `gh repo view <owner/repo> --json defaultBranchRef -q .defaultBranchRef.name`. The radar walks against its conf's
`base=`, which defaults to `main`; where the two differ, a merge the radar cannot place on its base gets today's answer
(`stale-tip` or `stale-review`).

Then **end your turn.** Do not sleep-poll. Do not "check in five minutes". The
delivery lane will inject the worker's mail into your session when it is idle,
and that injection is your next turn.
