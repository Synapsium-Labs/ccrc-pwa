# The wave lifecycle: step 1, open the run

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## 1 — Open the run

1. Copy `references/ledger-template.md` to
   `docs/superpowers/programs/<slug>.md` in the project's own repo, fill the
   header and the wave-1 row, and **commit it**. The commit is the artefact; an
   uncommitted ledger is not a handoff.
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","programmeTitle":"<the programme's name, used only when this opens a new programme>","project":"<project>","homeProject":"<the project this programme lives in>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,"ledgerPath":…,"ledgerRepo":…,"ledgerAbsPath":…}`, or one of the refusals below.

| refused | what it means | what you do |
|---|---|---|
| `claimed-by-another` | another coordinator holds this program; `by` names it | stop (clause 8) |
| `project-mismatch` | the `sessionId` you passed belongs to a workspace in ANOTHER project; `by` names that project. Or it names an EXISTING session of the run's project and you sit outside that project; `by` names YOUR project and a `detail` says a crossing spawns fresh. Or your own registry row records no project; a `detail` says so and there is no `by`. Where you sit never refuses an open by itself; it only stops you rebinding an existing session: a coordinator may sit in ANY project and run a programme whose home and runs are elsewhere (the operator's ruling of 2026-10-18) | do not retry with the same id. A wave that changes project, or any wave into a project you do not sit in, opens WITHOUT `sessionId` and spawns fresh in the target repo. The no-project case: stop and report. Nothing was opened and nothing was held |
| `home-mismatch` | this programme already stores a DIFFERENT home project; `by` names the stored one | stop and report. A programme has one home — the repo holding its ledger, spec and plan — and it does not move. Either you are addressing the wrong programme or the `homeProject` you sent is wrong. Nothing was opened |
| `claimant-is-a-worker` | the `claimedBy` you sent is itself the WORKER of an open run; `by` names that worker's coordinator | stop and report. A dispatched worker never opens a run — the board brackets one level and a chain would render its middle detached. This session is a worker until its own run is closed; nothing was opened and nothing was held |
| `workspace-spent` | the `sessionId` you passed is a CHILD workspace — one carrying the `$REG/<id>.child` marker, ordinarily minted for a run — whose branch has already had a PR (open, draft, merged or closed); `pr` names it. A child carries at most one PR | open the wave again WITHOUT `sessionId`; its dispatch mints a fresh child (§5, "One PR per child"). Nothing was opened and nothing was held |
| `spent-unmeasured` | the `sessionId` you passed may be a spent child and the server could not tell: the child marker, the PR ledger, the registry listing or the live PR lookup did not answer; `detail` says which. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY `sessionId`, marked or not — without the listing the server cannot tell a child from any other workspace | retry the same open. It is NOT `workspace-spent` — the evidence was unreadable, not absent — so do not drop `sessionId` on its account. If it repeats, stop and report. When the repeated `detail` shows the child's branch or tip does not resolve (a hand rename), the next run opens on a fresh child rather than retrying this one. Nothing was opened and nothing was held |
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

   **And it is PR-FREE.** A workspace carrying the `$REG/<id>.child` marker —
   ordinarily one the server minted for a run — is a CHILD, and a MARKED child
   carries at most one PR: once its branch has had one, naming it here is
   refused `workspace-spent` (table above), whatever the project. An UNMARKED
   producer is never refused this way. See §5, "One PR per child".

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
