# The wave lifecycle, in full

Every call below goes through `ccrc-api`, set up once in SKILL.md's "How to
call the API" — the client resolves the server address from
`~/.ccrc/agent.env` and reads the box token itself, refusing rather than
guessing at either, so no call below handles an address or a secret. One **run row per
wave**: `POST /api/runs` opens a new run for each wave of a program, not one
row for the whole program. `$REG` is `$HOME/.cc-sessions` throughout — SKILL.md's
"Learn who you are, first" defines it once and reads `$REG/<id>.uuid` for
`fromUuid`, the pair every mail call below needs.

## 1 — Open the run

1. Copy `references/ledger-template.md` to
   `docs/superpowers/programs/<slug>.md` in the project's own repo, fill the
   header and the wave-1 row, and **commit it**. The commit is the artefact; an
   uncommitted ledger is not a handoff.
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","project":"<project>","homeProject":"<the project this programme lives in>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,"ledgerPath":…,"ledgerRepo":…,"ledgerAbsPath":…}`, or one of the refusals below.

| refused | what it means | what you do |
|---|---|---|
| `claimed-by-another` | another coordinator holds this program; `by` names it | stop (clause 8) |
| `project-mismatch` | the `sessionId` you passed belongs to a workspace in ANOTHER project; `by` names that project | do not retry with the same id. A wave that changes project opens WITHOUT `sessionId` and spawns fresh in the target repo. Nothing was opened and nothing was held |
| `home-mismatch` | this programme already stores a DIFFERENT home project; `by` names the stored one | stop and report. A programme has one home — the repo holding its ledger, spec and plan — and it does not move. Either you are addressing the wrong programme or the `homeProject` you sent is wrong. Nothing was opened |
| `claimant-is-a-worker` | the `claimedBy` you sent is itself the WORKER of an open run; `by` names that worker's coordinator | stop and report. A dispatched worker never opens a run — the board brackets one level and a chain would render its middle detached. This session is a worker until its own run is closed; nothing was opened and nothing was held |
| `workspace-spent` | the `sessionId` you passed is a CHILD workspace — one the server minted for a run — whose branch has already had a PR (open, draft, merged or closed); `pr` names it. A child carries at most one PR | open the wave again WITHOUT `sessionId`; its dispatch mints a fresh child (§5, "One PR per child"). Nothing was opened and nothing was held |
| `spent-unmeasured` | the `sessionId` you passed may be a spent child and the server could not tell: the child marker, the PR ledger, the registry listing or the live PR lookup did not answer; `detail` says which. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY `sessionId`, marked or not — without the listing the server cannot tell a child from any other workspace | retry the same open. It is NOT `workspace-spent` — the evidence was unreadable, not absent — so do not drop `sessionId` on its account. If it repeats, stop and report. Nothing was opened and nothing was held |
| `error:'bad-request'` (400) with a `detail` | the programme slug is longer than the shared budget (`detail` reads `program must be at most 56 characters`), or is not `[A-Za-z0-9_-]+` | **this is the refusal a too-long slug actually earns** — shorten the programme slug and retry. Refused at the door: nothing is opened, no programme row is written, and no `ws-hold` runs |
| `error:'hold-invalid'` (400) | a wave, denominator, or exact generated/reused run id is not a positive JavaScript safe integer | stop and report the input defect. A fresh refusal rolls both inserts back; no `ws-hold` runs |
| `error:'hold-oversize'` (413) | DEFENCE IN DEPTH, and unreachable from this route today | the slug cap above is derived so that the widest hold this route can compose is 124 of 127 characters, so a slug that would overflow is refused as `bad-request` before `openRun` is called. The row is kept because the store enforces it for any future non-HTTP caller; §2 and §3 CAN emit it, on persisted rows that never passed this door |

**Why `project-mismatch` exists.** A session's workspace is a git worktree in
exactly one repository. Reusing its id for a wave in another project queues the
brief onto a workspace bound to the wrong repo, and the mismatch used to surface
one advance later as a `tip-unmeasurable` naming a branch you did not expect.
The server measures it two ways — here, from the run history, and again at
dispatch from the live registry row (§2) — and refuses both times. A session no
run has ever named refuses nothing: absence permits, which is exactly the
wave-1 open that adopts a workspace the operator made by hand.

**`homeProject`, and the ledger path it names.** `ledgerRepo` echoes the home the
programme now stores, and `ledgerAbsPath` is ONLY that home's programme ledger by
ABSOLUTE path. It is not the home repository root, it is not the plan path, and a
coordinator must not derive either from it. Both response fields are `null` while
the programme stores no home. The server refuses an open with no `homeProject`
outright, `400 bad-request` with `detail: 'homeProject is required'` — the
legacy generation that tolerated it ended 2026-09-16; send it on every open. A
programme that stores no home takes the FIRST home any open sends — first writer
wins, recorded as `home-project-backfilled` on that run — and nothing in the API
can change it afterwards: a later open sending a different value is refused
`home-mismatch` against it. Send the programme's home, the repo holding its ledger,
spec and plan — never the repo you happen to be running in. The server trims the
value and refuses one that is not a single path segment (a `/`, `.` or `..`) with
a `400 bad-request` whose `detail` names `homeProject`.

   For wave ≥ 2, reclaiming the workspace wave 1 held, add
   `"sessionId":"<the held session id>"` to the same call — it tells the open
   route this run reuses an existing workspace, so the next dispatch resumes
   it instead of spawning a fresh one.

   **That reclaim is SAME-PROJECT.** `sessionId` reclaims a workspace, and a
   workspace lives in ONE repo — so a wave that changes project sends no
   `sessionId` at all and takes wave 1's own fresh-spawn path in the target
   project. Naming a session whose workspace belongs to another project is
   refused `project-mismatch`, `by:` that project, before any run row exists.

   **And it is PR-FREE.** A workspace the server minted for a run is a CHILD,
   and a child carries at most one PR: once its branch has had one, naming it
   here is refused `workspace-spent` (table above), whatever the project. See
   §5, "One PR per child".

   **Every open carries the home**, on every wave of the programme:
   `"homeProject":"<the home project>"` in the same body. The response answers
   `ledgerRepo` (the home project) and `ledgerAbsPath` (the home repo's
   programme ledger, absolute) beside the `ledgerPath` it always carried; both
   are null while the stored home is null, which is what a legacy-generation
   programme opened before this field existed still reads. A later open naming a
   DIFFERENT home is refused `home-mismatch`, `by:` the stored value.

**The hold, precisely.** When this call names `sessionId` (wave ≥ 2, reclaiming
an existing workspace), the server places the hold immediately, reason
`program:<slug> wave:<N>/M run:<id>`, naming the run it has just opened. Wave
1's open has no workspace yet — nothing is held until wave 1's own dispatch
(§2) places it, same shape, `wave:1/M run:<id>`. The only hold that carries no
`run:` suffix is the one an ordinary close writes for wave N+1 when no
successor run exists yet (§5, step 4) — there is no id to name at that moment. A
coordinator that checks for a hold between wave 1's open and its dispatch and
finds none has not found a bug — it has found the exact window before the
workspace exists. Either way the reason is **display-only** — never parse a
hold reason to learn what wave you are on. Ask `GET /api/runs` and read the
run row's own `wave`.

## 2 — Dispatch a wave

`POST /api/runs/:id/dispatch`
`{"brief":"<the wave brief, prose>","items":["<title>", …],"route":{"class":"…","effort":"…","subagent":"…","workflow":"…","compact":"…"}}`
→ `{"ok":true,"id":<run id>,"sessionId":…,"resumed":…,"clearedAt":…,"briefQueued":…}`
with the run now `dispatched`, or a refusal:

| refused | what it means | what you do |
|---|---|---|
| `paused` | `$REG/coordinator-paused` exists | stop, report, touch nothing |
| `mail-disabled` | `$REG/mail-disabled` exists | stop, report, touch nothing |
| `cap-concurrency` | `maxConcurrentWorkers` is full | stop, name the cap, wait |
| `cap-daily` | `maxSessionsPerDay` is used up | stop, name the cap, wait |
| `ambiguous-dispatch` | wave 1's spawn found 0 or >1 candidate workspaces | stop and report; the operator resolves it |
| `worker-busy` | wave ≥ 2's session is observably mid-turn | wait and retry; do not force it |
| `hookstate-unmeasurable` | wave ≥ 2's session has a hookstate file the server could not READ — so whether it is mid-turn was never measured at all | retry once: nothing was spawned, the run is untouched and still `planned`, and the workspace was only resumed. If it repeats, stop and report — a file on the fleet host needs a human, and this refusal will stand until it is readable |
| `project-mismatch` | wave ≥ 2's session has a registry row whose `.project` was READ and names ANOTHER project than this run's; `by` names the project that was read. A row whose `.project` cannot be read answers `registry-unmeasurable` instead — take that code by its OWN row below (stop and report; never a blind retry): its wire shape is identical to the one a killed `ws-add` can send, so you cannot tell from the response which rung answered. A row with no `.project` at all is not refused | stop and report. Nothing was spawned, no `/clear` was sent, and the run is untouched and still `planned` — but the OPEN that named this `sessionId` placed a hold on that workspace, a worktree in the wrong repo, and it is still standing. Do not retry this dispatch, and do not simply open the wave again without `sessionId`: an open of the same still-`planned` wave returns the SAME run, still bound to the crossing session, and the next dispatch refuses identically. The operator must abandon the wedged run from the console; only after the operator reports it abandoned do you open the wave again WITHOUT `sessionId` so it spawns fresh in the target repo |
| `workspace-spent` | wave ≥ 2's session is a CHILD whose branch has had a PR since this run was opened — usually the previous wave's worker opened it after you opened this wave on its workspace; `pr` names it. The body also carries `unbound`, and `detail` whenever `unbound` is `false` | `unbound:true`: the server has already released the workspace (or handed its claim to the other run still open on it), cleared this run's `sessionId` and left the run `planned` — dispatch it again, unchanged, and a fresh child is minted, branching from the project's default branch and carrying none of the spent producer's unmerged commits; if this wave depends on that producer's code, wait until its PR is proven merged, exactly as the cross-project arm (§5) requires, before dispatching again. `unbound:false`: that release (or hand-over) did not happen, or it happened but the run was no longer `planned` and bound by the time it completed — `detail` says which; a `detail` naming a PERMANENT cause (this box's ccd does not support the verb, the surviving run's claim could not be written, or the other runs naming the workspace could not be read) means stop and report, and any other `detail` means retry the same dispatch once, and if it repeats, stop and report. Either way nothing was resumed and no `/clear` was sent |
| `spent-unmeasured` | wave ≥ 2's session may be a spent child and the evidence could not be read; `detail` says which read failed. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY session, marked or not — where a resume used to answer `error: 'registry-unmeasurable'` — because without the listing the server cannot tell a child from any other workspace; but dispatch lists the registry for its own pause check FIRST, so a registry that is ALREADY unlistable there answers `paused` instead (the row above) and never reaches here — this code's unlistable case is a listing that fails only at the resume arm's own re-read, after that pause check's listing already succeeded. `unbound` is always `false` | retry the same dispatch: the binding is kept, nothing was resumed and no `/clear` was sent. It is not `workspace-spent`. If it repeats, stop and report |

**Caps count ACTIVE runs, not holds and not merely non-terminal ones.**
Concurrency counts dispatched runs whose state is ACTIVE — `dispatched`,
`working`, `unknown` — so a terminal producer retained on a hold, a planned
undispatched consumer, and a run parked IDLE at `awaiting-review`, `merging` or
`closing` all consume no running-worker slot. **An idle run gives its slot back
WITHOUT closing** (D-2803); before wave 6 of review-runs it held one until it
reached a terminal state, and prose written against that older rule is wrong
rather than merely imprecise. Each actual dispatch still consumes daily budget,
and a dispatched run consumes one concurrency slot for as long as it stays
active. Each refusal's own numbers are the authority, and the two
carry DIFFERENT ones: `cap-concurrency` carries `limit` and `running`, while
`cap-daily` carries `limit` and `used` — it never carries `running`, so a
coordinator refused `cap-daily` that goes looking for one is reading a field
the frame does not have.

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
  startup prompt before you re-dispatch — and to close any narrow terminal first, because one
  attached to any session makes the next spawn narrow too.
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
object of the FIVE writable fields — `class`, `effort`, `subagent`,
`workflow`, `compact` — whose vocabularies `references/routing-matrix.md`
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
without the other. Omitting `route` sends the identical bare argv it
always has. The brief still names the routing in prose (clause 13) — this
object is what carries that placement to the fleet, never a replacement
for saying so.

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

Then **end your turn.** Do not sleep-poll. Do not "check in five minutes". The
delivery lane will inject the worker's mail into your session when it is idle,
and that injection is your next turn.

## 3 — Read mail

What lands in your session is NOT the message — it is a tiny one-line nudge
("`ccrc-mail: you have new mail. List (GET /api/mail?to=<you>); per row use
its deliveryId, NOT id…`") that points at it. The nudge is the same 24-char
text every time and carries no delivery id itself: one nudge means "you have
outstanding mail", not "here is one message" — always re-list rather than
assuming the nudge names exactly one row.

0. **List**: `GET /api/mail?to=<your session id>`. This returns only
   OUTSTANDING mail — `queued`/`delivered` (unacked), plus a delivery the lane
   gave up retrying before anyone acted on it (`state:"rejected"`,
   distinguishable by that field) — never a row you have already acked. Add
   `&all=1` to read the full history instead (every state, including
   `acked`), which is what you want for a human-facing "what happened"
   question, never for "what do I still owe an answer to" — reading history
   for the latter is how a wave gets dispatched twice (a stale copy of a
   `wave-done` you already acted on reads identically to new work unless you
   separately filter on `state`, which the unfiltered history does not do for
   you). **Each row carries two ids — `id` and `deliveryId` — and they are
   NOT interchangeable** (re-opened D-41): `id` is the message's own id, but
   `GET /api/mail/:id` and `POST /api/mail/:id/ack` below both key on the
   DELIVERY id. The two only happen to be numerically equal for a mail sent
   to exactly one recipient; a mail fanned out to several recipients gives
   each of you a different `deliveryId` for the SAME `id`. **Always use
   `deliveryId`** for the next two calls — using `id` fetches or acks a
   different worker's copy (or 404s) and leaves your own delivery to replay
   until the lane gives up on it.

For each outstanding row, with `:id` below filled in from its `deliveryId`
(never its `id` — see above):

1. `GET /api/mail/:id` to fetch the body — the envelope shape in
   `references/mail-envelope.md`, served verbatim (never re-rendered) from
   what was queued. Token-gated the same as every other call here; no
   `fromId`/`fromUuid` needed for this read.
2. `POST /api/mail/:id/ack` **before acting on it**, body
   `{"fromId":"<your id>","fromUuid":"<your uuid>"}` — the exact pair from
   "Learn who you are, first" ($id, $uuid). Anything else 400s `bad-kind`; a
   `fromUuid` that does not match `$REG/<your id>.uuid` 403s `stale-uuid` (the
   file this session's own `/clear` would rotate — re-read it if you have any
   doubt). Until you ack, the lane keeps re-injecting the nudge on later
   sweeps — the SAME nudge, not a growing pile of them — and the mail it
   points at is still there when you list again. This is bounded, not
   forever: past a bounded number of replay attempts the lane gives up and
   marks the delivery undeliverable (`state:"rejected"` — it stays visible on
   the list above, since it was never acked and never acted on). If you see
   the nudge fire several times for what looks like the same mail, that is a
   signal to ack (or act on) it now, not a promise it will keep arriving
   indefinitely.
3. Then act.

**Sending mail of your own** — a rejection (§4), a question, a status
update — is `POST /api/mail`, body:

```json
{"fromId":"<your id>","fromUuid":"<your uuid>","toId":"<recipient id>",
 "runId":<run id or null>,"kind":"answer|question|status|finding|artifact",
 "subject":"<subject>","body":"<body>","artifacts":["<absolute path>", …]}
```

Same `fromId`/`fromUuid` pair as the ack, checked the same way. `artifacts`,
when given, must be **absolute paths** — the ingress refuses a relative one
`bad-kind` — because the recipient reads the file directly, from whatever
directory its own turn happens to be in, not from this session's.

**One `kind`/`subject` pair has a body SHAPE rather than free prose:** a
worker's `status`/`wave-done`, whose four fingerprint fields the coordinator
submits unchanged. The worked example is in §4 — a worker sent here by its own
skill should read that block before it writes its first done-claim.

**Addressing, and the one rule that keeps it boring.** A worker is addressed
either by its session id or as `toId:"worker"` with the run — the role resolves to
whatever session that run currently names, which is what makes a replacement
reachable without anyone re-typing an id. So carry the `runId` on every mail you
send, whichever role you address: with it, `coordinator` resolves off that run's
own claim regardless of programme state and `worker` resolves off its `sessionId`;
without it, `coordinator` falls back to the single active programme and a `worker`
mail with no `runId` is refused `unknown-recipient`. One habit, no asymmetry to
remember. Reading a programme's whole lane is `GET /api/mail?program=<slug>&all=1`
— without `&all=1` it answers only what is still outstanding, exactly as `?to=`
does above — and its records are `GET /api/feed?program=<slug>`, which is always
the full archive with no outstanding/all split of its own; together they are the
filters that make a cross-repo programme legible from one call instead of two per
repo.

## 4 — Advance the run as the wave progresses

`RunState` reaches `awaiting-review` only from `working`, and `merging` only
from `awaiting-review` — there is NO `working` → `merging` edge
(`RUN_TRANSITIONS`, `shared/api.ts`), even for a wave whose PR is already
approved when `wave-done` lands. Send `{"to":"merging"}` straight from
`working` and the server 409s `bad-transition`; the accurate sequence always
passes through `awaiting-review`. Every call is `POST /api/runs/:id/advance`,
body `{"to":"<state>","fingerprint":{branchTip,prNumber,prPhase,handoffCommit}}`
— **the `fingerprint` object is REQUIRED on every call, including
`{"to":"working"}`**, even though that step does not re-measure it: a request
missing it, or with any field of the wrong shape (`branchTip`/`handoffCommit`/
`prPhase` not a string, or `prNumber` not a number-or-null), 400s
`{"ok":false,"error":"bad-request"}` before the run row is even looked at —
this one code rides `error`, not `reject.code`, unlike everything else this
route sends (see SKILL.md's field-check rule). For `{"to":"working"}`, where
there is nothing yet to claim, send the empty-claim shape:
`{"branchTip":"","prNumber":null,"prPhase":"none","handoffCommit":""}`.

**The shape a `wave-done` mail carries it in.** The fingerprint is the
worker's to measure and yours to submit unchanged, so it travels as JSON in
the mail body rather than as prose you would have to re-type by eye. One
correct wave-done body, minimal — both shas below are PLACEHOLDERS, and a real
claim repeats one and the same 40-hex sha in both fields:

```json
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open",
 "handoffCommit":"<the same 40-hex sha>"}
```

Prose around that object is fine and often useful. Prose INSTEAD of it is what
produces `pr-unmeasurable` below: "PR #591 is green" is not a `prPhase`, and
inventing one out of a sentence is the single commonest way a finished wave is
refused.

**Two signal lines open the body** (routing spec §5.5; worker clause 15), before any prose and
before the JSON — the first two lines, in either order, grammar exactly `key: word` with one space:
`suite: green|red|unrun` (the whole suite on its FIRST full run after the wave's implementation
was complete — red stays red however many fix rounds followed; unrun when no full run happened)
and, only when a check failed, `failure: shallow|ceiling|unclear` (shallow: tests missed, a plan
half-followed — raise effort; ceiling: an ambiguity the worker could not resolve, a design flaw,
a debug that survived two attempts — raise class; unclear: effort-first). A complete body:

```
suite: red
failure: ceiling
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open","handoffCommit":"<the same 40-hex sha>"}
```

The server reads them from the mail row, never from the envelope: `GET /api/runs/:id/signals`
answers `signals.suite` and `signals.failure`, each one of THREE answers — a value, `absent`
(the line was not sent: an older worker, or nothing to say), or `unrecognised` (a line was sent
with a word outside the vocabulary — a defect in the worker's report, surfaced, never read as
silence). They are what spec §6's first-run quality signal and clause 13's next-wave routing
decision read; a wave-done that omits the suite line is accepted by the fingerprint route all the
same, and shows as `absent`.

- **`{"to":"working"}`** — no re-measurement (this is a status marker, not a
  doneness claim; the fingerprint above only satisfies the shape check and is
  never read). Send it once the worker is genuinely underway, and ALSO to
  send work back from `awaiting-review`, or to record a lost merge race from
  `merging` — `RUN_TRANSITIONS` treats both as the ordinary case, not a
  failure, and neither re-measures.
- **`{"to":"awaiting-review"}`** (from `working`) or **`{"to":"merging"}`**
  (from `awaiting-review` ONLY — see above) — re-measured. Send it when a
  `status`/`wave-done` mail carries a claimed fingerprint (`{branchTip,
  prNumber, prPhase, handoffCommit}`). Submit that fingerprint **exactly as
  the worker reported it** — never rebuild it by pairing a freshly re-measured
  `branchTip` with the mail's ORIGINAL `handoffCommit`; see the
  `no-handoff-commit` row below for what that specific mix produces. Re-
  measuring locally first (read-only ccd is fine here: `ccd pr-state
  --session <worker id>`, and `git -C <worktree> rev-parse` for the tip) is a
  sanity check on the claim before you spend a round trip on it — never a
  source for half the submission — and either way **believe the server's own
  re-measurement over yours** (contract clause 6). A mismatch answers
  `{"ok":false,"reject":{"code":"<code>","detail":"<why>"}}` and leaves the
  run state untouched:

| reject.code | meaning |
|---|---|
| `stale-tip` | the branch moved after the claim was written |
| `tip-unmeasurable` | the branch tip could not be re-read (not evidence either way). On a REVIEW run's close it can also mean the reviewed run itself cannot be measured (it names no run, is gone, or has no session); the answer there is `{"state":"failed"}` on the review run, not a re-submit. |
| `branch-unmeasurable` | the workspace's branch could not be resolved: the live registry has a row for this session and the row's own branch field is null — either listed with bytes that did not come back (transient) or absent (not). Not evidence either way; the run is unchanged. Re-submit once the registry reads clean. If it keeps answering this, the session's registry row needs a human — the run row's frozen branch column is deliberately not used as a guess |
| `pr-regressed` | the PR is not in the phase the claim asserted |
| `pr-unmeasurable` | the PR state could not be re-read (not evidence either way) — but see below: this is ALSO what a malformed submission of your own gets, before any I/O runs |
| `no-handoff-commit` | `handoffCommit` and `branchTip`, IN THIS CLAIM, are not the identical 40-hex sha (or either fails the sha shape) — a correspondence check ONLY ("the worker's two facts agree, and the tip is real"), never a claim that the commit's *content* is a real handoff (that stays the review run's job, §5 step 1). It fires on a perfectly good wave if you submit a freshly re-measured `branchTip` alongside the mail's ORIGINAL `handoffCommit`: any review fix, lint fix or merge commit pushed to the branch after `wave-done` moves the tip away from what the worker claimed, and mixing the two sources here reports that ordinary shape as this code instead of the accurate `stale-tip` |
| `unknown-run` | the run id is wrong |
| `not-dispatched` | this run has no worker session to re-measure against |
| `bad-transition` | `to` is not reachable from the run's current state |
| `review-in-flight` | a non-terminal review run already names this work run — on an OPEN, a second reviewer for one wave; on an ADVANCE to `working`, a send-back while its review is still open. Close the review run first (body `{"state":"failed"}` if it died — no fingerprint needed), then retry. |
| `stale-review` | the reviewed branch's live tip is not the `reviewedTip` the report describes — the worker pushed after wave-done, or the report is about an older tip. Do not rule on it: close the review run with body `{"state":"failed"}` (no fingerprint needed), mail the worker the code and detail verbatim, and open a fresh review run against the live tip once its re-measured wave-done arrives. (A malformed `reviewedTip` reaching the verifier directly also answers this code, but the close route refuses that shape as `bad-request` first.) |
| `report-unreadable` | the report path the reviewer named cannot be opened — absent or unreadable. Close the review run with body `{"state":"failed"}` (no fingerprint needed) and open a new one; the reviewer's clause 7 says the report is written by temp-then-rename, so a half-written file is never the cause. |

**`pr-unmeasurable` has two causes, and they need different responses.** The
server returns it both for a transient re-read failure (`detail` reads like
`"pr-state answered …"` or names a stderr) AND, before any I/O runs at all,
for a malformed submission of your own: an omitted `prPhase`, or one spelled
outside its eight-value vocabulary — `unchecked | none | no-commits | open |
draft | merged | closed | unknown` (`PrPhase`, `shared/api.ts`) — refuses this
SAME code (`fingerprint.ts`'s claim-shape check runs before any registry or
`pr-state` read). A natural-language `prPhase` (the kind a `wave-done` body
prose like "PR #591 is green" might tempt you to invent, rather than one of
the eight values above) hits this every time. Read `detail`, not just for the
human-facing report: `"prPhase must be a recognised PrPhase…"` means fix the
field and resubmit now; anything else means a transient fleet problem, worth
a retry. Retrying a malformed claim without reading `detail` first repeats
the same refusal forever.

Mail the code back to the worker — `POST /api/mail` (§3's body shape), kind
`answer`, subject `rejected: <code>`, `toId` the worker's session id, `runId`
this run's id — and leave the run alone. A stale `wave-done` must never
settle a wave.

**Put `reject.detail` in that mail's body, verbatim.** The code alone is not
always the whole message: `pr-unmeasurable` above means two different things —
"your `prPhase` is not one of the eight words" and "the fleet could not read
the PR" — and `detail` is the ONLY thing that separates them. The worker's own
skill tells it to read that detail and act on which one it is, so a rejection
that arrives with the code and nothing else asks a worker to guess between a
fix-and-resend and a wait-and-retry. Copy it as the server sent it; do not
paraphrase it into your own words.

**When a check failed, the failure kind names the rung** (spec §3):

```bash
printf '{"target":"worker","kind":"<shallow|ceiling|unclear>","why":"<one sentence>"}' | "$API" runs route "$run_id" --json -
```

— the server computes the rung from the ladders on the session's record, writes it through the
routing verb with no `--apply` (ccd applies it at the next settle or idle tick), and records a run
event; `ceiling`/`floor`/`no-record` (409) are answers, not errors — record them in the ledger and
decide by hand with `{"target":"worker","field":"<field>","value":"<value>","why":"…"}`.
**Demotion** is your judgement (§3): after three consecutive clean waves of one shape on one
session, `{"target":"worker","demote":"effort","why":"…"}`; any later failed check reverses it
before the ladder applies. Never `ccd route` (clause 1) and never `--apply` (clause 12's evidence
rule and spec §8 row 5). Every call that CHANGES a record is one run event and one journal row;
a refusal — the ladder's answers included — records neither.

**The reversal follows the SESSION, across every wave.** The door derives "the last unreversed
demotion" — and the same-kind count that gates `max` — by walking every run that names the target
session, worker or coordinator, in the order each `route:` event landed: a demotion taken on wave
N's run IS reversed by a failed check you report against wave N+1's run, on the same session, and
the same-kind count carries forward with it rather than restarting at zero. (D-2957, the run-scoped
rule this paragraph used to state, is CLOSED by routing slice 6 — the `route:` event now names its
own session, so the door can walk the session's whole trail instead of one run's rows.) Nothing
here changes what you send: report the failure against the CURRENT wave's run id as always, and
the door reads the session's history for you — there is no by-hand carry left to do.

**A class rung is two fields in one write.** An escalation or demotion that moves `class` resets
effort in the SAME call (spec §3 — effort names do not transfer across classes): to `high`, or to
`auto` onto haiku, which takes no effort level at all. The answer's `applied.effortReset` names
the value that went with it, and is `null` when the call wrote a single field — an effort rung, or
a manual `field`/`value` write, which this door forwards exactly as you typed it.

### 4b — Settle the work items, AFTER the advance answers `ok`

`GET /api/runs/:id/items` / `POST /api/runs/:id/items`
`{"items":[{"id":<item id>,"state":"done","claimedBy":"<worker id>"}, …]}`
→ `{"ok":true,"id":<run id>,"items":{"done":<n>,"total":<n>}}` — the fresh
tally, which is what the board renders.

**Order is the authorisation.** Send this only once `POST /api/runs/:id/advance`
has answered `ok` for the same claim. That answer is the server's own
re-measurement, and it is the moment ccrc is allowed to believe a worker
(contract clause 6). Settling never off the worker's claim alone: a tally that
flips to `5/5` because a mail said so is a lie on the console, and the console
is the product. Nothing re-measures here — this route performs no fleet act at
all — precisely because the re-measurement already happened one call earlier.

`state` is one of `pending` / `claimed` / `done` / `failed` / `abandoned`.
`unknown` is a READ-side value the board uses for a token it does not
recognise; a writer may not name it (400 `bad-request`). `claimedBy` is
optional and defaults to `null`. Item ids come from the run row's own ledger —
`GET /api/runs` carries the tally, and the ids are the ones the dispatch
declared, in body order.

A batch is **all-or-nothing**, inside one transaction: a body naming one bad
id settles NOTHING, and the earlier ids in the same body are untouched.
Partial success on a ledger write is how tallies drift.

| shape | meaning | what you do |
|---|---|---|
| `refused:'unknown-item'` (404), with `itemId` | that id is not THIS run's item (another run's, or none) | **stop and report** — do not retry with a guessed id. Re-read the run's ledger first |
| `refused:'item-terminal'` (409), with `itemId` and `state` | the item already settled (`done`/`failed`/`abandoned` are terminal) and the write was refused, not silently applied | **stop and report** — a tally that moved backwards is a lie on the console. If the item genuinely needs a different outcome, that is an operator decision, not a retry |
| `error:'unknown-run'` (404) | the run id is wrong or the DB was rebuilt | re-read `GET /api/runs` |
| `error:'bad-request'` (400) | shape: no `items` array, an empty one, a non-integer id, a `state` outside the vocabulary, or past 32 entries | fix the body; nothing was written |

## 5 — The boundary: open the next wave's run, THEN close this one

**The handoff review is a REVIEW RUN, and the held-out panel is its shape** (clause 14,
`references/review-panel.md`): three Opus lenses over the wave's commit range, three Sonnet
refuters per finding, majority deciding, model and effort literal in the script. The REVIEWER
runs it — this session dispatches the review run and rules on the report it returns (step 1
below, clause 12); a lens that returned nothing is a review not yet done, never an approval.

**Order is load-bearing here, and it is the opposite of what you might guess.**
A program is `active` only while it has at least one open (non-`done`,
non-`failed`) run; the instant its open-run count reaches zero the server
marks it `done`/`abandoned`, and nothing ever reactivates it. `toId:'coordinator'`
mail with no explicit `runId` resolves through `resolveCoordinator(null)`,
which requires exactly one program in state `active`. Closing this wave's run
before opening the next one, even for the few seconds between the two calls,
drops this program's open-run count to zero — the program retires right then,
and from that instant every such message is refused `unknown-recipient`,
**permanently: nothing in the HTTP API reactivates a retired program, not
even opening a fresh run under the same slug** (`openRun`'s own conflict arm
only ever updates the program row's `title`, never its `state`). Recovery is
an operator/DB act, not a client one — or address the mail with an explicit
`runId` instead of relying on the `'coordinator'` role resolving to it, which
`resolveCoordinator(runId)` answers off that run's own claim regardless of
program state. **Open first** — the new run keeps the count above zero the
whole time, which is the only prevention this ordering rule buys.

1. Dispatch a review run and rule on its report (SKILL.md steps 5–6, clause 12); this session never reads the diff itself.
2. Update the ledger — Waves row, Decisions, Carried constraints, and the
   **Next-wave brief**, which is the whole of what the fresh session reads.
   Commit it.
3. `POST /api/runs` for wave N+1 (§1, step 2) before closing this run. The
   program now has two open runs (this wave's, still `working`/
   `awaiting-review`/`merging`, and the new `planned` one), so it can never
   read as zero between waves.

   **One PR per child — the PR decides `sessionId`, not the project.** A
   workspace the server minted for a run is a CHILD, and a child carries at
   most one PR. A fresh child always branches from the project's default
   branch — `ccd ws-add` sets `base` from `git symbolic-ref
   refs/remotes/origin/HEAD` — so it carries NONE of a spent producer's
   unmerged commits. If this producer's workspace opened a PR — the ordinary
   case for a wave that shipped code — it is SPENT: open wave N+1 WITHOUT its
   `sessionId`, even in the same project, and close the producer exactly as
   the cross-project arm below closes it: `final:true`, then require
   `released:true`, then require its own closed row's `state` to be `done`
   (`"$API" runs list --closed 1`) — and, if wave N+1 depends on an interface
   from this producer, independently prove that producer's PR merged at the
   exact SHA before dispatching wave N+1, because the closed row proves
   fingerprint and terminal state, never merge. The same-project arm is for a
   producer whose workspace opened no PR — a research or measurement wave —
   and only for that. Naming a spent workspace is refused `workspace-spent`,
   with `pr` naming the PR, and nothing is opened; `spent-unmeasured` means
   the server could not read the evidence either way — retry the same open,
   and do not drop `sessionId` on its account. If the PR lands after you
   opened wave N+1 on the workspace, the DISPATCH refuses `workspace-spent`
   instead (§2); with `unbound:true` it has already released the workspace
   and unbound the run — dispatch it again and a fresh child is minted, again
   from the default branch and carrying none of the spent producer's code, so
   if wave N+1 depends on that code, wait for the same merge proof before
   redispatching.

   **Same project:** open wave N+1 first with this producer's `sessionId`, then
   close the producer with `final:false`; the hold transfers to the already-open
   successor on the same workspace. After that same-project close, run
   `"$API" runs list --closed 1`, find this producer by run id, and require its
   own `state` to be `done`.

   **Different project:** open wave N+1 first without this producer's `sessionId`,
   then close the producer with `final:true` and require `released:true`; there is
   no same-workspace successor to receive a synthetic hold. After that
   cross-project close, run `"$API" runs list --closed 1`, find this producer by
   run id, and require its own `state` to be `done`. If the consumer depends on
   an interface from this producer, independently prove the producer interface
   PR merged at the exact `producerSha` carried with `producerRepoRoot` and
   `producerSourceRepoPath` in the conditional producer contract. The closed row
   proves fingerprint and terminal state, not merge.

   A missing/non-`done` producer row, failed release, or required exact-SHA merge
   proof that is absent means report and do not dispatch. The default `runs list`
   excludes `done` and `failed` rows, so it cannot perform the state check.
4. The close re-measures the SAME facts, against the SAME codes, as `/advance`
   does (skipped only on an explicit `"state":"failed"` abandon). Its response
   SHAPE differs from §4's table: a mismatch answers
   `{"ok":false,"error":"<code>","detail":"<why>"}` — `error`, not
   `reject.code` — so read `$body.error` on this route, not `$body.reject`.
   Two refusals besides the re-measurement codes are `not-dispatched` and
   `prhistory-unreadable`; both ride `refused`. A hold write that would exceed
   the hook's display window answers `error:'hold-oversize'` (413), while an
   invalid stored programme or numeric domain answers `error:'hold-invalid'`
   (400). Both leave the run open; report rather than retrying unchanged.
5. Dispatch wave N+1 (§2, step 2) only after the applicable close, closed-row
   proof, release proof, and exact-SHA merge proof above succeed.

## 6 — Final merge

`POST /api/runs/:id/close` `{"fingerprint":{…},"final":true}` on the last
wave's run — re-measures, closes this run `done`, and releases the hold
(`ws-release`) **only when no other open run names this session**. The response
carries `released`. `released: true` means the claim is gone — this workspace is
an ordinary unheld, unclaimed row again, and nothing archives it: it stays live
and supervised until a human archives it. `released: false` means the
claim was **handed over**, not dropped: another run still owns this workspace,
so the hold was rewritten with that run's own reason and nothing was archived.
That is not an error — it is the ordinary consequence of opening wave N+1
before closing wave N — but the program is not finished until that run closes
too. The same field rides the abandon response.

Since Build 8 the merged sweep asks the same question the close does, before it
picks which notice to push: a workspace whose hold is absent but whose run is
still open is announced as **still claimed**, naming that run. Releasing a hold
by hand only changes which of the two notices the next sweep sends.

Neither notice archives anything, and nothing else does either. A merged
workspace stays where it is — live, supervised, its PR merged — until a human
archives it, and when a human does, its manifest carries the whole PR lineage.
You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.

## What happened to a workspace that is gone

`GET /api/lifecycle?session=<id>` — the provenance journal, oldest-first, with the mirror's own
gaps beside it. It takes a session cookie or the box token, so it reads cookieless from the fleet
host the same way `GET /api/runs` does.

Read it when a workspace has been removed and you need to answer who did it, why, and what was
lost. It is the only surface that survives a removal: every per-session registry field is deleted
by the cleanup itself, and the journal is written where that deletion cannot reach.

Three families sit side by side on every row and they never merge. `obs` is what the kernel saw,
`dec` is what the caller declared, `meas` is what was measured about the workspace before anything
was destroyed. When the first two disagree the census raises it as a divergence; nothing picks a
winner. A `null` in `meas` means it was not measured, never that it was empty.

## The run's own signals — a measurement, never a dial

`GET /api/runs/:id/signals` — speed and quality signals re-measured off this run's own rows: the
worker's paired holds, a swap COUNT (swap TIME is unpairable in today's journal, and the wire says
so rather than guessing), and the closes this run was REFUSED. It takes a session cookie or the box
token, so it reads cookieless from the fleet host the same way `GET /api/runs` does. Since routing
slice 2 it also answers `waveDoneMails` (how many `wave-done` mails the worker sent on this run)
and `signals` — the two signal lines off the LAST of them, or `null` when there are none (§4
above). `error:'unknown-run'` (404) means the id is wrong or the DB was rebuilt;
`error:'bad-request'` (400) means the id is not an integer.

```
run_id=<the run id>
"$API" runs signals "$run_id"
```

answers the holds, the swap count, the refused-close count, `waveDoneMails` and the two signal
lines off the last of them — every field this section names, off one call.

It writes nothing — the refused-close count it reports is the row `POST /api/runs/:id/close` already
recorded when it refused you, not a new judgement about the worker. And nothing it reports licenses
a different dispatch: it exists so a wave's speed and cost can be read AFTER the fact (routing spec
2026-09-14 §6), so read it when the operator asks what a wave cost, not while a wave is running. A
worker re-cut, re-ordered or leaned on because a counter moved is a wave steered by a number that
was only ever meant to describe it.

Since routing slice 5 it also answers `arm` — the routing fields the dispatcher seeded onto this
run's FIRST well-formed `arm:` event, or `null` for an old run, a dispatch that carried no routing
at all, OR a run whose `arm:` rows are all malformed — and `routing`, every routing change since,
in order: the door's escalations, demotions, reversals and manual overrides that landed on this run
after it was dispatched. `armUnparsed` and `routingUnparsed` count the rows their own parser could
not read, never thrown away silently — a malformed record is still a fact worth surfacing; for
`arm`, `armUnparsed` is what tells its two `null` causes apart (S5-R9): `arm === null &&
armUnparsed === 0` means no arm was ever seeded (or this is an old run), while `arm === null &&
armUnparsed > 0` means an arm event exists that could not be parsed, and the run is excluded from
its arm's mean. A run whose `routing` is non-empty changed routing mid-flight and is read apart
from its arm's mean (§6): the arm says what the wave started on, `routing` says what moved after.

## The routing door — escalation, demotion, and manual overrides

`POST /api/runs/:id/route` is the ONLY way the coordinator changes a run's session onto a
different rung of the class/effort ladders (routing spec 2026-09-14 §5.3, slice 5) — never
`ccd route` directly (clause 1). Body: `{"target":"worker"|"coordinator","why":"<1..400 bytes,
no control characters>", ...one of...}`:

- `"kind":"shallow"|"ceiling"|"unclear"` — walk `escalate()` (`references/routing-matrix.md`'s
  own Escalation paragraph) off the target session's SERVED class/effort (a degraded lane's
  ladder runs off the degraded class, never the record's own).
- `"demote":"class"|"effort"` — walk `demote()`, one rung down, never below the mechanical floor.
- `"field":"class"|"effort"|"subagent"|"workflow"|"compact"`, `"value":"<string>"` — the
  coordinator's own judgement; this door checks only SHAPE (non-empty, no control characters,
  <= 32 bytes) — ccd's `_route_valid` is the sole authority on whether the value is a legal
  member of that field's own vocabulary.

Success answers `{"ok":true,"applied":{"session","mode","field","from","to","kind","effortReset"}}`,
`mode` one of `escalate`/`demote`/`reverse-demotion`/`manual`; `effortReset` is the companion
effort a CLASS rung wrote in the same argv (§4 above), `null` on a single-field write. Refusals: `no-session` (the target has no
session id on this run), `bad-session` (the target has a session id, but not one this door will write
into a routing event — a shape check, refused before the write rather than silently mis-recorded),
`no-record` (the registry has no `.class` file at all — an ABSENT `.effort`
alongside a present `.class` is not this: it reads as `effort: 'auto'`, the record's own vocabulary
for "no override, the model's default"), `unrouteable-record` (`.class`/`.effort`/`.degraded` IS
present and readable but its content is not a rung of the ladder — a record, not a rung: a stray ccd
value like `class=default`, or a torn/never-written field — refused
here rather than silently resolved to the ladder's bottom rung), `registry-unreadable` (transient
— one of the three registry files is listed but unreadable), `run-closed` (the run is in a
TERMINAL state — `done` or `failed`; every other state, including `unknown` and `planned`, is
routable and refuses later on its true reason), `ceiling`/`floor`/`no-effort-rungs` (the ladder, or the
degraded-record guard, has nowhere to move this request to — an answer, not an error),
`unsupported` (501, the fleet host predates `route-v1`), `fleetFailed` (502, ccd refused the write
— no run event is recorded on a refusal). Any failed check reverses the target SESSION's last
unreversed demotion before the ladder applies to the new failure — that bookkeeping is derived
from the session's own event trail, across every run it touches as worker or coordinator, not sent
by the caller (§4 above).

## Build 9 — peers, claims, deviations (wave 7 surface)

The protocol prose for these routes lands with the build-9 skill wave (coordinator clause 10,
worker clause 11, `references/peer-protocol.md`). The lines here name the surface so the
route-parity suite binds each registration to this corpus from the commit that registers it.

- `GET /api/peers` — who else is on this project; read each row's own `deliverable` and
  `lifecycle`, never its archive stamp.
- `POST /api/claims` — claim every path the wave will touch, before splitting the work; a 409
  names every holder and hands each address.
- `POST /api/claims/:id/release` — release on the final merge, with the claimant's own attribution.
- `GET /api/claims` — the live claim table for a project (`?all=1` includes ended rows).
- `POST /api/ledger/deviations` — allocate the program's D-number block at run-open; never
  invent a number, and never reuse one.
- `GET /api/ledger` — the allocation record and the floor for a project.

## The ask lane — pre-empting a child's question (Tasks 9-11)

Clause 11 is what licenses this: `POST /api/asks/:id/answer` is the one route that types into
a child's pane, and this session never does it by any other means. All three routes in the
lane are named here — a coordinator IS a parent and calls all three, so this is the truthful
entry, not an invitation like the operator-only doors above.

```bash
: "${ask_id:?set ask_id to the held ask row positive decimal id}"
"$API" asks answer "$ask_id" --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid","optionIndexes":[0]}
JSON
```

Press an answer in with that body. A 409 from this route can come from three
route/CAS guards before `answerAsk` (`not-held`, `ask-moved`, or
`child-unmeasurable`) or from a downstream `answerAsk` refusal. No refusal path
presses a digit when the eligible ask is single-select, which is the only shape
this hold lane mints; after a downstream refusal the route rolls the row back to
`held`.
- `not-held` — the row has LEFT `held` and is no longer pre-emptible. That is FOUR different
  endings, not one: another principal is mid-answer, the grace window lapsed and the operator
  was notified after all, the child's dialog went away, or someone already ruled. Only the
  first is a race a retry could win, and you cannot tell which from this code alone — read the
  row (`GET /api/asks`, below) rather than retrying blind. (This entry said "a lost race
  against another principal that already took the row" for one wave, naming one of the four:
  the gloss came from `store.ts`, where it was equally wrong, and both were corrected together.)
- `ask-moved` — the CHILD REPAINTED AN IDENTICAL QUESTION since this row was minted; the menu
  on its screen right now may be a different instance of what looks like the same question.
  This IS a reason to re-read the ask and answer the CURRENT one, never a reason to retry the
  same call — a blind retry risks pressing a digit into a menu that has since moved on.
- `child-unmeasurable` — the server could not read the child's live state at all (no session
  record, no measured identity, or no readable hookstate). Nothing has moved and nothing is
  wrong with your call: re-reading the ask will show you the same `held` row it showed before,
  so do NOT loop on it. Wait for the next tick, or leave it to the grace window, which fires
  the operator's own notification on schedule regardless.
- Downstream `answerAsk` refusals include `stale-ask`, `not-waiting`,
  `ask-mismatch`, `multi-question`, `range`, `multiselect`, `duplicate-index`,
  `not-alive`, `no-menu`, and `menu-mismatch`. Each names the failed live-state,
  option, or pane guard; stop and re-read rather than treating 409 as three
  possible conditions or retrying blind. Counting both halves, this route answers
  409 with thirteen (3 + 10) distinct codes.
```bash
: "${ask_id:?set ask_id to the held ask row positive decimal id}"
"$API" asks release "$ask_id" --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid"}
JSON
```

Decline to rule on it with that body. A decline is not a failure: it is what turns the grace window
into a CEILING rather than a flat tax on every question you cannot answer — the operator's
notification fires AT ONCE on release, instead of the child's question sitting quiet until the
window lapses on its own. Decline anything that would be a NEW decision (clause 11's own
words — product intent, scope, a tradeoff nobody ruled on, anything irreversible) rather than
guessing at it.
```bash
"$API" asks list
```

Read your own children's HELD asks — the ones still waiting on a ruling — to see whether two of
them are asking contradictory things before either grace window lapses. The client hard-codes
`state=held`, which is NARROWER than the open set the route itself can return: an ask another
principal has already taken reads `answering`, and this view deliberately omits it, because a row
someone else is mid-answer on is not yours to rule on. The client derives this pane's parent id and
current uuid and sends both; neither is caller-selectable. `--parent <your id>` is accepted only
  as a matching compatibility assertion and cannot select another parent. The box token alone proves
  only "a process on this box", never WHICH parent is asking, so the derived uuid supplies the same
  attribution proof `/answer` and `/release` take above.

What the ask row does NOT carry is the reason to answer it. `question` and `options` are its
entire evidentiary surface — no rationale, no chat history, no transcript of the child's
reasoning is readable through any route in this tree. Rule only from what you can already read
elsewhere: the spec, the plan, the ledger, the branch, and your own prior rulings on this
program. If answering would require guessing rather than reading, decline it.
