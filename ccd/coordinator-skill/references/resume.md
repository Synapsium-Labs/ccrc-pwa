# Resuming a coordinator

A coordinator is disposable by design and a program is meant to survive its death — but only if the
revive preserves the one thing the server compares: the SESSION ID. This is the runbook for that, and
for the case where the id is already lost.

Two readers: the OPERATOR performing the revive, and the fresh coordinator that wakes up in the revived
pane. Nothing here is a fleet act this session performs on itself — clause 1 stands. The revive happens
at a terminal or from the PWA, by a human.

Every call named below is made exactly as SKILL.md's "How to call the API" sets it up. This file carries
no second copy of that setup, of the address, or of the token.

## 1. Measure first: is the program still open, and who claims it?

    body=$("$API" runs list)

`GET /api/runs` is the whole orientation. Find this program's rows and read three fields off the newest
open one:

- `claimedBy` — the session id the server will accept calls from. THIS is the identity a revive has to
  preserve. It is not a workspace name, not an account, and not something a fresh session can be told.
- `wave` — which wave the program is on. Never infer that from a hold reason: the reason is display-only,
  it lands on the WORKER's workspace, and a coordinator may carry none at all.
- `state` — `planned` means the wave was opened and never dispatched; `working` means a worker is out
  there holding a brief.

The default scope of that route excludes closed runs, so a program with no row here is retired. Mail
addressed to the `coordinator` role with no `runId` then resolves to nothing — the runId-less form needs
exactly one active program. Mail that names the `runId` explicitly still resolves, and that is the
documented recovery (`references/wave-lifecycle.md` §5, `resolveCoordinator`), not a reason to open
a fresh run.

## 2. The invariant: same session id, or the program is wedged

`POST /api/runs` refuses any later call for a program whose `claimedBy` differs from whichever session
first opened it — `claimed-by-another`, contract clause 8, decided in `CoordStore.openRun`. The refusal
does not lapse when the named session dies, and no call named in this corpus ever rewrites `claimedBy`:
a fresh coordinator under a new id cannot take the program over by any move of its own. Handing the
program to a different session is an operator act, performed from the console, and it sits outside this
session's reach for the reason clause 4's pause marker does — a wedge's release valve behind the wedged
session's own key is not a release valve. So the refusal is still a STOP for you: report it, and say
which run is wedged and which id it names.

Everything else keeps working, which is what makes this easy to misread. Mail still routes to the dead
id, the board still renders the program, and only this one call refuses. The wedge surfaces at the wave
boundary, when the next run has to be opened.

A session id is minted once, at creation, from the account and the project — and it does not change
afterwards. A session keeps the id it was born with across every account swap, so `claimedBy` may name
an account that session no longer runs on. Re-creating the session from what the board renders TODAY
therefore mints a DIFFERENT id for a session that already exists. That is the trap this runbook exists
to avoid.

## 3. The two id-preserving revives

Both of these are the OPERATOR's act, at a terminal or in the PWA.

**At a terminal on the fleet host — the ONE-ARGUMENT form:**

    ccd start <id>

One argument means "the session that already exists, under the id it already has". The two-argument
`<wrapper> <project>` form is the CREATING form: it recomputes the id from that pair, which is exactly
how an operator who reads the current account off the board mints a second id for a live session. The
one-argument form cannot do that — it refuses an id with no registry row, naming the creating form in
the message rather than resolving to a guess, and where the argument disagrees with the registry about
the ACCOUNT the registry wins, with a warning that names the verb which would actually move it. On a
session that is already alive it is a no-op that says so; on a dead one it respawns and resumes the
transcript.

**From the PWA — the session's `Restart session` control.** It calls ccd's own `ensure` on this id
(`/api/sessions/:id/ensure`; `cmd_ensure` in ccd), so the id is in the PATH and this form cannot mint a
new one either. It is written here without an HTTP method on purpose: a method spelled in front of a
path in this corpus means "a call you make", and this is not one — it is the browser's own
cookie-bearing call, it is not on the armed gate's exempt list, and a fleet-host session cannot post it
cookieless. On a pane that has died it builds a new pane and the conversation is resumed from the
transcript; on a pane that is running but unclaimed it writes the registry claim and adopts the pane,
restarting nothing and losing nothing. If the last spawn stopped on a login screen or a limit banner,
this hits the same banner again — the account lane has to be fixed, or the session moved, first.

## 4. Briefing the revived coordinator

The machine kickoff the PWA writes when a program is STARTED hardcodes wave 1 — correct exactly once,
and wrong for every revive after it. A revive gets the wave-N text below instead, and the console sends
exactly this text: the resume control on a run whose coordinator reads dead composes it from that run's
own id and wave, out of `programResumeKickoff` in `shared/api.ts` — one source, so this file and that
control cannot drift — and queues it as mail rather than typing it into a pane
(`/api/sessions/:id/kickoff`, spelled without a method for the same reason `/api/sessions/:id/ensure`
is above: the browser's own cookie-bearing call, not one a fleet-host session can make). Hand-typing it
at a terminal is still the fallback. Either way, this is the text:

    You are the coordinator for program `<slug>` (<title>).
    Its ledger is `docs/superpowers/programs/<slug>.md`.
    Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read `GET /api/runs`,
    find run <run id> at wave <N>, and pick that wave up where the ledger says it
    stands. Do not open the run for wave <N> again, and do not open wave 1 again.

Those last two sentences are the load-bearing half. An open run does not need re-opening, and re-opening
is not a harmless no-op: the open route dedupes ONLY a retry naming the same program, wave and
`claimedBy` against a row that is still `planned`. Re-opening a `working` wave, or opening wave 1 on a
program that is at wave 5, writes a SECOND row — a second ledger the board renders, and an open-run
count the program never gets back down to zero.

First acts of the revived session, in order: read the ledger commit; `GET /api/runs`;
`GET /api/runs/:id/items` for the wave's declared ledger, the only route that publishes item ids; then
read outstanding mail before deciding anything. A worker that finished while the coordinator was dead
has its `wave-done` waiting there, and acting off the ledger alone re-dispatches finished work.

## 5. A dead WORKER is not this door

A worker that dies mid-wave is recovered by re-dispatching fresh into the held workspace — SKILL.md's
"When something is wrong" says so, and the dispatch route is the one writer of the `/clear` step
(clause 9). Reaching for a revive door on a worker instead skips the state transition the board renders
and leaves a wave nobody advanced. This runbook is about the COORDINATOR's own death.

## 6. When the id is already lost — the terminal recovery

If the original id can no longer be revived, this session is not the one that fixes it: every
`POST /api/runs` for that program answers `claimed-by-another`, naming a session that may no longer
exist, and retrying spends turns on a refusal that is working exactly as designed. Stop and report,
naming the run and the id it claims. That report IS the act — the operator has a console door that
hands the program to a living session, and the report is how it gets reached.

If the program was ALSO re-opened under a different id, that half is a recovery on the box rather than
a call: a second run row is a second ledger, and no reassignment merges them.

Two things make that recovery ordinary rather than frightening. The database is snapshotted before every
deploy — the newest `~/ccrc-backups/<ts>/coord.db` is the restore path, and it is the FIRST thing to
check. And the database was never the ground truth in the first place: the committed ledger, the session
registry and `.prhistory` are. `CoordStore.reconstruct` is the drill that rebuilds a program's runs from
exactly those three — a TEST rather than an operator tool (`server/test/coord-store.test.ts` is what
exercises the method; `server/test/reconstruction-drill.test.ts` is the separate artifact drill, which
imports no production code at all and re-derives the same program from the files by hand). That is why
it is a constraint on what may be stored rather than a button. Its rebuilt rows carry no claimant at
all, and the one-coordinator guard skips rows with none, so a reconstructed program is claimable again
by whichever session opens its next wave.
