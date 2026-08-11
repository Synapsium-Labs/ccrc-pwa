# ccrc — self-hosted remote control for the Claude Code fleet

A mobile-first, installable PWA to view and drive the `ccd` fleet of
`--remote-control` Claude Code sessions on server-box, over Tailscale. It follows
sessions across account swaps — the thing the official claude.ai app can't do.

**Install URL (tailnet only):** `https://server-box.tailnet-example.ts.net:8443/`
Add to home screen in Android Chrome / iOS Safari for the standalone app.

> ccrc lives on port **8443**, not 443 root. The `claude-docserver` owns 443
> root — it serves every project's docs at `https://<host>/<project>/…`, and
> those root-path URLs are referenced all over generated specs/plans. A PWA
> can't share that path space (its SPA fallback would swallow every doc path
> and serve index.html), so ccrc keeps its own port.

## Architecture

- `server/` — Node ≥22.13.0 (`engines.node`; `node:sqlite` needs it unflagged,
  and `server/test/node-floor.test.ts` pins both the declaration and the
  import) + Fastify (TS ESM). One process, systemd user unit
  `ccrc.service`, bound to the Tailscale address only (`CCRC_HOST:CCRC_PORT`,
  default `127.0.0.1:7788`; the box runs `203.0.113.7:7788`). One SQLite
  database, `~/.ccrc/coord.db`, opened with `node:sqlite` (`DatabaseSync`,
  WAL, `user_version` migrations that refuse to start rather than open
  empty) — holding runs, work items, mail and coordinator state. This
  repeals "No database," deliberately and in writing: the deferral had an
  owner and a named trigger
  (`docs/superpowers/specs/2026-08-06-attention-ux-design.md:356-357`, "No
  SQLite… belongs to Build 7, not here"), and Build 7 is that trigger
  arriving. ccd's flat files — the registry, the hold, `.prhistory` — stay
  the fleet's own authority; the database holds only what coordination adds
  on top of them, never a replacement for them (see "Fleet coordination"
  below). Everything else still reads ccd's flat files and shells out to
  `ccd`/`tmux` directly through an injected `Runner`/`FleetIO` in **local**
  fleet mode; in **remote** fleet mode the exact same seams are backed by a
  WS client talking to `agent/` on the fleet host instead (see "Remote fleet
  mode" below). Either way the whole thing is unit-testable off-box against
  fixtures.
- `agent/` — Node ≥22.13.0 (same `engines.node` floor as `server/`; the three
  packages must agree — `node-floor.test.ts` — though `node:sqlite` itself is
  server-only) WS service (TS ESM) that runs ON the fleet host and
  exposes a small, whitelisted exec/file/tail/pty surface over a bearer-token
  connection. Only needed for remote fleet mode; local mode never touches it.
- `pwa/` — React + Vite installable PWA ("phosphor & ink" design). Builds into
  `server/dist-pwa`, which the server serves at `/`.
- `shared/` — `agent-protocol.ts` (server↔agent WS message types) and
  `api.ts` (server↔PWA REST/WS types), imported by both `server/` and
  `agent/`.
- `ccd/` — the pieces that live on the **fleet host**: `ccd` itself, plus
  `session-hook.sh` (the Claude Code hook that reports each session's state)
  and `install-session-hooks.sh` (the idempotent installer that registers it
  in every wrapper home). See "How a session's state is known" below.
- `deploy/` — `ccrc.service` / `ccrc-agent.service` (systemd user units),
  `ccrc.env.example` / `ccrc-agent.env.example` (env templates — copy to
  `ccrc.env` / `ccrc-agent.env`, gitignored, to supply real tokens),
  `notify.sh` (ccd swap hook → `/api/notify`), `deploy.sh`.

HTTPS is fronted by `tailscale serve` on port 8443 (a secure context is required
for the service worker + WebAPK install). 443 root is the claude-docserver
(project docs at `/<project>/…`) with mech-fleet-preview at `/fleet`; ccrc can't
take 443 root without its SPA fallback swallowing every doc path, so it stays on
its own port.

## How a session's state is known

**Hooks first, the pane as a ranked fallback.** Claude Code fires hooks on its
own lifecycle, so ccrc no longer has to infer what a session is doing from
terminal text.

`ccd/session-hook.sh` runs on the hot path of every tool call in every fleet
session and writes `~/.cc-sessions/<id>.hookstate.json` atomically. Its contract
is absolute: **exit 0 on every path**, write atomically or not at all, no
network, no locks, no waiting — a hook that can slow or break a session is worse
than no hook. It self-identifies from tmux (`cc-<id>`), so a non-fleet session
exits silently. `install-session-hooks.sh` registers it in every wrapper home
the `ACCOUNTS` roster marks `hooksAble` — five today (`~/.claude`,
`~/.claude-personal`, `~/.claude-corp`, `~/.claude-gpt`, `~/.claude-dev0`),
sweeping its own managed entries and leaving anything else in `settings.json`
untouched; every write is `jq`-gated and backed up to `~/ccrc-backups/<ts>/`.

The file carries one of three states — `working`, `waiting`, `done` — plus a
structured **ask envelope** for a waiting session: either
`{questions: [...]}` (an `AskUserQuestion`, copied verbatim from the tool call's
own JSON) or `{approval: {tool, summary}}` (a permission prompt), and the
subagents the hooks have seen start and stop.

`server/src/hookstate.ts` reads it and **fails to null** on anything it cannot
vouch for: a missing file, over 64 KB, malformed JSON, an unrecognised state, a
`sessionId` that no longer matches the registry's uuid for that session (so a
restarted session cannot inherit its predecessor's state), or a write older than
30 minutes. `null` therefore means *no fresh hook data* — never a fourth state.

The pane scraper still runs, and still raises a dialog the hook never got a
write for (an older Claude Code, a hook that failed to install). Neither source
suppresses the other; the PWA prefers the envelope and falls back to the scrape.

### The branch takes the name the model already wrote

A workspace is born `ws/soft-prairie` — two words from a random table, fixing
the session id, the directory, the tmux session, the unit, the registry key and
the branch. The name says nothing about the work. Claude Code, meanwhile, has
already written one: every transcript carries an `ai-title` line generated from
the first prompt, and until now nothing read it.

`FleetWatcher`'s naming lane (10 s) renames the branch to that title, slugified:
lowercase, non-alphanumeric runs collapsed to `-`, at most 40 characters cut
back to a word boundary, prefixed `ws/`. It fires only while the branch is still
exactly its born name — that comparison *is* the idempotence marker, so there is
no new registry field and nothing to clean up on reap — and it reads the
transcript behind a size+mtime gate, so a transcript with no title (nine of 609
on this box) is not re-read forever.

**A branch that has been pushed is never renamed — checked two ways against
origin; when origin is unreachable the rename proceeds with a warning.**
`ccd ws-rename` refuses with `has-upstream` for a configured tracking upstream
OR the old name showing up on origin directly, so a branch pushed by hand with
no `-u` (no upstream is configured, but the name is on the remote) is caught
the same as one pushed through `ccd pr-open`'s `--set-upstream`. Both probes
ask only `origin`, and — refusing here would make ws-rename unusable offline
for a branch that has never been pushed — both warn and proceed rather than
refuse when it cannot be reached. `ccd ws-rename` also refuses `registry-branch-drift`
when git's own record for the worktree disagrees with the registry's `branch`
field — the same corroboration `ws-reap` already requires — so a workspace
hand-renamed with a bare `git branch -m` (bypassing this verb, and so never
updating the registry) cannot have some *other* branch renamed out from under
it by a sweep that still believes the registry's stale name. It refuses in
JSON on stdout at exit 0 — fourteen named tokens, whose copy lives in
`server/src/wsaudit.ts` — and the one REFUSAL path that keeps a non-zero exit
is `git branch -m` itself failing, a fault rather than a refusal (the only
other non-zero path is the python3-availability probe at the top of the
function, also a fault, not a refusal). A refused workspace keeps its born
name. Five of the fourteen refusals describe a fact about the workspace that a
later title cannot change — `has-upstream`, `not-a-workspace`,
`worktree-unregistered`, `worktree-foreign` and `registry-branch-drift`
(`server/src/watch.ts`'s `PERMANENT_REFUSALS`; the last three ship their own
remedy in the refusal detail — the first two a `git -C $main worktree add …`,
the last a re-run of `ccd ws-rename` once the registry and git agree again —
so "cannot stop being true" holds only in the sense that no title fixes it) —
and those retire the session outright: no further attempt, on any title, until
the server restarts — or until Claude Code rotates that session's own uuid (a
`/clear`, a compaction), which `ccd`'s `_sync_uuid` mirrors into the registry
and which earns a fresh incarnation just as a restart does, since retirement
is keyed on `<id>#<uuid>` (`server/src/watch.ts`'s `attemptedRenames`
docstring has the mechanism). `bad-branch` is a verdict on the *derived branch*, not the
workspace, so it is deliberately not in that set — a title that changes can
change it — even though `deriveBranch` never actually emits a name `ccd` would
reject, so the refusal does not fire in practice. Every other refusal marks
only that one `(session, derived name)` pair attempted, so a title that
changes to a different slug still earns a fresh attempt on the next sweep.

The name types itself into the fleet line and the session header when it lands
(`pwa/src/fleet/TypedLabel.tsx`); `prefers-reduced-motion` swaps it instantly.
The workspace slug itself never changes — the archive list, the PR sheet and the
cleanup confirmation all still name the directory on disk.

### The attention bucket

Every session on the fleet wire carries `bucket` and `bucketSince`, computed
once, server-side, in `server/src/bucket.ts`. The fleet screen's sections, its
counts and each row's own state word all read that one field, so they cannot
disagree — before this there were three independent re-derivations that drifted.

The ladder tests, in order: `archivedAt` (→ `cleanup` when the PR is merged,
else `archived`), then `dead`, then `attention` (a pending dialog or a waiting
hook), then `working`, then `done` (which requires hook evidence — a hookless
busy→idle transition never proves a turn *finished*), then `idle`. **The
archived rows come first deliberately**: `ws-archive` stops the session, so
every cleanup candidate is also `dead`, and a dead-first ladder would leave the
cleanup bucket permanently empty.

`bucketSince` is *derived* from evidence already on the record — never
remembered by the watcher, which would reset on every deploy and paint the whole
fleet as freshly-unseen several times a day.

`status` itself stays frozen and hook-blind; a test asserts it is identical with
and without hook state present.

### Workspace holds & programs

A **hold** is a program's declared claim on a workspace — `ccd ws-hold
--session <id> --reason <text>` writes `$REG/<id>.hold`, and `ccd ws-release
--session <id>` removes it. No timeout, no expiry, ever: the claim lasts as
long as the reason is true, and the reason string *is* the whole display —
verbatim on the fleet chip, the actions sheet, and the held-merged push,
parsed nowhere. Workspace-only (a main checkout has nothing to protect) and an
archived workspace refuses (restore first). An empty *or whitespace-only*
reason refuses in all three layers — the composer and `ccd ws-hold` share one
sentence (`empty reason — say which program holds this`), while the route
answers a bare 400 `bad-request`, which is what a non-PWA client sees.

A hold has exactly two consumers. `archiveMerged`'s auto-archive gate becomes
*merged **and unheld*** — `held === null` is the new conjunct — so a workspace
idle between two waves of the same program reads as claimed, not finished, and
survives a sweep even after its PR merges. The hold is re-read from the
registry at the archive decision point, not taken from the snapshot the sweep
opened with, so a hold placed *during* a sweep still lands. And `ws-rm` /
`ws-reap` grow one refusal rung apiece:
destroying a workspace a program declared mid-flight takes two deliberate acts,
never one — `ws-rm` dies with `held: <reason> — release first`, `ws-reap`
answers `{"refused":"held"}`, and the cleanup sheet renders that as "A program
has this workspace held — it is mid-flight, so nothing was removed." Release
first, then clean up. Unchanged: the bucket ladder, `ws-archive` itself, and
manual archive/restore — a merged-but-held workspace can still be archived by
hand from the PR sheet, which is why that sheet names the hold instead of
promising a sweep that will never come. See
[`docs/superpowers/programs/TEMPLATE.md`](docs/superpowers/programs/TEMPLATE.md)
for the wave-handoff ledger a program keeps beside its hold.

## Programs, runs and mail — the operator's view

A **program** is a long-horizon effort with a slug and a markdown ledger
(`docs/superpowers/programs/<slug>.md`, in the project's own repo, committed,
and parsed by nothing). A **run** is one wave of it in one workspace. A
**coordinator** is an ordinary fleet session running the `ccrc-coordinator`
skill, placed by `_ws_least_loaded` like any other session, acting through the
server's HTTP API and never raw `ccd`. See "Fleet coordination" below for the
skill's contract, the run lifecycle, the mail bus and its box token, caps and
pause, why `ws-reap` stays human-only, and the honest boundary — this section
covers only what that one does not: the install lane, the PWA surfaces, the
disaster-recovery drill, and the Build 4 dogfood runbook.

**The skill ships to every `hooksAble` account home — five today, not four.**
Skills resolve per `CLAUDE_CONFIG_DIR`, and a session's account drifts on
swap — so `ccd/install-coordinator-skill.sh` installs into the `ACCOUNTS`
roster's `hooksAble` config dirs (`~/.claude`, `~/.claude-personal`,
`~/.claude-corp`, `~/.claude-gpt` and `~/.claude-dev0`), the same
roster-derived list `install-session-hooks.sh` uses — never a hand-typed one,
which is exactly the trap `shared/api.ts`'s own roster comment names by
incident — on every agent deploy, idempotently, backing up anything it
replaces. That lane is what makes "place the coordinator like any other
session" safe.

**Three surfaces.** `/runs` is the board — runs grouped by program, with their
own status words (a run is a lifecycle position, not an attention state, so it
borrows none of the bucket vocabulary and nothing on it glows). `/mail` is the
durable feed, reached from the ✉ beside the bell. Every session's own
outstanding mail sits above the composer, one row above the task strip.
Records land in the feed whether or not you were watching — only the *push*
is presence-gated; a record of an agent-to-agent message is a fact about the
fleet, and it is kept either way.

**If the database is lost**, a program is reconstructible from its ledger
(committed to the project's own repo) plus the registry and `.prhistory` on
the **fleet host** — `server/test/reconstruction-drill.test.ts` is that
procedure, executed against fixtures, naming by name what it recovers and
what it cannot.

### Dogfood: Build 4 is the first coordinated program

By decision (spec §9), the first program run through the coordinator is Build 4,
the transcript surface. Before starting it:

1. The token is on both boxes: `ls -l ~/.cc-secrets/ccrc-mail.token` on the
   fleet host and `~/.ccrc/mail.token` on the server, each `-rw-------`. Do not
   `cat` either one.
2. `ls ~/.claude*/skills/ccrc-coordinator/SKILL.md` lists one path per
   `hooksAble` account home — five today.
3. `~/.cc-sessions/coordinator-paused` does **not** exist, on the **fleet
   host** — a dispatch reads it there and refuses `409 {refused:'paused'}`
   with no PWA indicator, so checking on the wrong box is a silent no-op.
4. The ledger exists and is committed: copy `docs/superpowers/programs/TEMPLATE.md`
   to `docs/superpowers/programs/build4-transcript-surface.md`, fill the header
   and wave 1, commit.
5. Open the run, then dispatch. Watch `/runs`; read `/mail`.

Success is a program that completes with human pauses only at review points,
and an audit trail that reads true.

## Attention, notifications and answering

- **Unseen watermark** (`pwa/src/lib/seen.ts`): a session is unseen when it
  entered a human-wanting bucket (`attention`, `done`, `cleanup`) after this
  device last acknowledged it. Per-device in `localStorage` on purpose — ccrc
  has no user accounts, so "seen" belongs to the person holding the phone.
- **Push copy discipline** (`server/src/watch.ts`): project context appears in a
  title only when more than one project is active, and nothing fires for a
  session a client reports on screen. The PWA states that claim on every socket
  open and refreshes it every 15 s; the server expires a claim it has not heard
  for 45 s, so a phone that loses signal without a close frame goes back to
  being notified rather than silently muted.
- **Answering from the notification**: an ask push carries the question's first
  two option labels as notification actions, and `pwa/public/push-sw.js` POSTs
  the answer without opening the app. A button is offered *only* where the
  answer route would accept it — an action that can only be refused costs a tap
  and a wait to learn what the server already knew.
- **Catch-up watermark**: `{epoch, seq}` as one atomic JSON value on both sides
  (`server/src/notifylog.ts`, `pwa/src/lib/notifymark.ts`). A seq is meaningless
  without the lifetime of the counter that produced it — written separately, a
  death between the two writes forges a valid-looking pair and silently drops
  real notifications. When the server cannot *prove* the client saw everything
  it says `resync`, and the client then surfaces nothing retroactively.

Three routes can act on a session, each with its own named refusals:

| Route | What it does | Gate |
| --- | --- | --- |
| `POST /api/sessions/:id/dialog` | answers a **pane** menu by walking the `❯` marker | refuses a stale dialog id; never presses Enter unless the re-captured pane proves the marker landed |
| `POST /api/sessions/:id/ask` | answers a **hook-reported** question by option index | re-reads the current envelope and refuses unless a content digest still matches, the pane still shows that exact menu, and the question is single |
| `POST /api/sessions/:id/submit` | presses **one** Enter on a box that already holds text | refuses unless the box matches the text the caller expected; one Enter, never a retry loop |

## Accounts: usage, placement and the disabled marker

**`/accounts`** (a fourth branch of the route ternary, reached by tapping the
compact `AccountsStrip` mounted in the desktop top bar and the mobile fleet
list) shows every account ccd knows about, not just the ones with headroom.
It rides the existing `GET /api/accounts` pipeline — no new route, no new
whitelist grant — with its own 20 s poller. Per account:

- Both windows (5h / 7d) as bars with the strip's exact `%`/`reset`/`—`
  three-way, never collapsed: `reset` means the window ended and the zero is
  *inferred* from the reset timestamp; a measured `0%` means something ran
  and the account really is empty; `—` means nothing has ever been measured.
- A freshness line, **"last reported *age*"**. Telemetry is a byproduct of a
  session rendering its statusline, so an idle account simply stops
  reporting — the screen reads as "last known", never as live. There is no
  refresh button: there is nothing to refresh until a session runs.
- A disabled lane (`~/.cc-sessions/<wrapper>-disabled` present) renders
  **greyed with "disabled on the fleet host" — shown as switched off, never
  hidden.** The compact strip still hides a disabled lane entirely (right for
  an always-on bar); the screen's whole job is "show me my accounts", so
  hiding one here would be the wrong call in the other direction.
- Live sessions whose `wrapper` matches the account, each tapping through to
  `/s/<id>`.
- A projection line naming ccd's own placement rule ("next workspace lands
  here — least-loaded"), including the all-disabled case below.

Band coloring uses one writer (`limitBand` from `LimitBar.tsx`) everywhere,
including the strip: `crit` is `> 75`, matching `DIRECTION.md`, not `>= 75` —
the strip used to carry its own copy of the threshold and disagreed with the
limits bar at exactly 75.

### Placement honors the disabled marker

`~/.cc-sessions/<wrapper>-disabled` used to be a **UI-only** kill-switch:
`server/src/limits.ts` parsed it for every lane, but ccd itself honored it
for exactly one (`gpt`, via `_gpt_enabled`) — `touch`ing it for any other
wrapper hid the account from every picker and changed nothing about where
ccd actually placed sessions. ccd now generalizes the check:

- `_lane_enabled <w>` — true iff `~/.cc-sessions/<w>-disabled` is absent.
- `_account_ok <w>` — true iff the wrapper is executable **and** its lane is
  enabled. `_gpt_enabled` is now just `_account_ok gpt`, same file, same
  semantics, one definition.

Both of ccd's automatic pickers gate on `_account_ok`: `_ws_least_loaded`
(`ws-add`'s placement rule) skips a disabled or missing lane outright, and
`_swap_target`'s candidate loop does the same, as does its "home recovered,
go back" branch — a session never auto-rotates back onto a home that has
since been disabled. **The two "stay put" branches are unchanged on
purpose**: disabled excludes a lane as a *destination*; it never evacuates a
session already sitting there. Manual placement (`ccd start`, `ccd swap`,
`ccd prefer`) bypasses the gate entirely — naming a wrapper by hand is an
operator override by construction.

**Pressure alone still never refuses placement** — a fully pinned account is
still the least-bad choice, and the headroom display is the warning, not a
refusal. Only the declared marker excludes. But if *every* wrapper fails
`_account_ok`, `ws-add` refuses **before creating anything** — no worktree,
no branch, no registry entry — naming each wrapper and why (`disabled` or
`missing`): `die "no account available for placement — …; nothing was
touched"`.

That refusal only covers the *declared* case. The score itself still has the
opposite polarity for the undeclared one, and this rider does not touch it:
`_limit_field` zeroes any sample whose window has run out — a `five` older
than 18000s, a `seven` older than 604800s, or either past its own
`resetAt` — and `_limit_score` returns `""` when a wrapper has no limits
file at all, which `_ws_least_loaded` and `_swap_target` both fold to `0`.
Zero is the *lowest* score either picker compares, so an account nobody has
heard from in a week — no file, or a sample its own window has outlived —
reads as maximum headroom and is placed **first**, not skipped. No
telemetry still reads as free for *pressure*; only the declared marker
excludes. The accounts screen's "last reported *age*" line is the only
signal that the "least-loaded" pick landed there because it is healthy
rather than because it has gone quiet; nothing short of the operator reading
that line and `touch`ing `-disabled` stops it.

The server mirrors only the half it can honestly see. `projectHome` filters
`disabled` lanes before scoring, and returns `null` when every home-able
lane is excluded — `ProjectedHome | null` on the wire (`GET /api/accounts`'s
`projected` field), rather than inventing a target. It cannot see `-x`: the
server has no filesystem authority over `~/.local/bin`, so a projection can
still name an account whose binary is gone. **ccd's refusal at `ws-add` is
the authority; the server's projection is a best-effort forecast of it.**
Kept in lockstep with the bash by the shared fixture harness
(`server/test/fixtures/leastLoaded.ts`, run against both implementations).

There is **no login detection** — no passive filesystem signal reliably
distinguishes a logged-in account from a logged-out one on this box, and a
probe-based check was rejected (spends tokens, races real logins). The
`-disabled` marker is a *declared* fact the operator sets by hand
(`touch`/`rm`), not a detected one.

### Login screens get no keystrokes, and lost auth joins the rescue lane

A session spawned onto a broken account used to spin its full ~15-minute
startup window, return with no diagnostic, and then type `/effort ultracode`
+ Enter **into the login screen** — an unreviewed keystroke into an auth
flow. `_accept_first_run_prompts` now recognizes a login screen (`Select
login method`, `Invalid API key`, `Please run /login`) as its **last**
check, after every ready-marker and startup gate, and returns a distinct
code instead of a silent success; `_spawn` skips the `/effort` injection on
that code, so no synthesized keystroke reaches an auth prompt. Instead it
warns, naming the session **and** the account (`_accept_first_run_prompts`
only ever sees the tmux name, so `_spawn` is what emits this, once it has
both back): `<id> is waiting for login on <wrapper> — attach and run
/login`.

Mid-session auth loss joins the same rescue lane a 429 uses: the
hard-blocked pane grep that drives `_auto_swap_check`'s emergency swap now
also matches `Invalid API key` and `Please run /login` — a session that
*was* working and lost auth evacuates immediately, exactly like a rate
limit. **`Select login method` deliberately stays out of that grep** — that
screen appears during an intentional operator login, and evacuating a
session out from under someone mid-login would be wrong; that screen is the
one case `_accept_first_run_prompts`'s login check owns instead, by warning
and stopping rather than swapping.

## The PWA↔server protocol handshake (dormant)

Nothing in the system stamps a version today — no `git` sha ships, no
`package.json` version key is read — and the one real skew window is a
stale client: the service worker checks for updates every 15 minutes, so an
open tab can hold pre-deploy JS against a post-deploy server. A synchronous
`hello` frame closes that gap without doing anything yet:

- `FLEET_PROTO` / `FLEET_PROTO_MIN` live once, in `shared/api.ts` beside
  `PRESENCE_REFRESH_MS` — both currently `1`, with `MIN <= PROTO` pinned by a
  test. **`FLEET_PROTO_MIN` is the kill-switch**: raise it above an old
  build's `FLEET_PROTO` to block that build. It is dormant until then.
- `/ws/fleet`'s first frame, sent synchronously before the async `fleet`
  snapshot, is `{ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN }`.
- **Absence permits.** A connection that never sends `hello` — an older
  server — never blocks the client; every already-deployed PWA already drops
  an unrecognized fleet frame silently, which is the safe direction.
  Blocking requires positive evidence: `hello.min` greater than the client's
  own `FLEET_PROTO`.
- Only the client self-blocks — the server never refuses a client; it has no
  way to know a build is "too new" and nothing here gives it one.
- A **later, compatible** `hello` on the same connection **clears** the
  block — deliberately not a one-way latch, so a reconnect to a fixed server
  unblocks a client that briefly saw a bad frame.
- While blocked, `BlockScreen` renders as a sibling *above* `.app-shell`
  (not inside it — a wire-protocol mismatch has no partial-functionality
  story), copy: *"This app build is too old for the fleet server.
  Updating…"* plus a manual Reload button. Becoming blocked also **acts**:
  it triggers the service worker's update check immediately rather than
  waiting for the 15-minute poll, so most clients self-heal without the
  button ever being needed.
- The session stream's reducer (`applySessionMsg`) gained a `default` arm
  that returns state unchanged — an old client receiving a frame type it
  doesn't know must shrug at it, not corrupt the store.
- `AgentReady.v` (the separate server↔agent pair) stays **deliberately
  unread** — declined, not forgotten: that pair already negotiates by
  *capability* (`ccdVerbs` + `verbSupported`), which is finer-grained than a
  bare generation number. `v` remains reserved for a future breaking
  frame-shape change and gets a consumer only then.

## Develop

```bash
cd server && npm ci && npm run test      # unit tests, hermetic
cd ../agent && npm ci && npm run test     # unit tests, hermetic
cd ../pwa && npm ci && npm run test       # component tests
```

Run the server against a fixture home: `CCRC_HOME=<tree> npm run dev` in `server/`.

## Deploy

```bash
bash deploy/deploy.sh                # server: build PWA here (freshness-gated) → rsync → box npm ci + build → restart unit → health check
bash deploy/deploy.sh agent <host>   # ccrc-agent: rsync → ship ccd + notify.sh (backed up) + session-hook.sh (installs it) → host npm ci + build → restart unit
```

`CCRC_BOX` overrides the server's default target (`you@203.0.113.7`);
the agent target's `<host>` defaults to `$CCRC_BOX` if omitted, but in
practice the fleet host is a different box (see "Remote fleet mode" below).
`CCRC_HEALTH_URL` overrides the server's post-deploy health-check URL
(default `http://203.0.113.7:7788/health`).

Both targets ship a local, gitignored env file to `~/.ccrc/` on the box first
if one exists (`deploy/ccrc.env` / `ccrc-agent.env` — copy from
the committed `*.env.example` templates and fill in real tokens; the real
files are never committed). The service units use `/usr/bin/env node` (box
node is in `/usr/local/bin`). Every run stamps its backups (previous ccd,
notify.sh, served dist trees) into `~/ccrc-backups/<timestamp>/` on the
target before overwriting anything — and a backup copy that *fails* aborts
the deploy before `rsync --delete` can destroy the state it failed to save.
The agent deploy installs `ccd` BEFORE restarting the agent — the agent
caches `ccd caps` at boot, so the reverse order pins a stale verb set.

**Ordering between the two targets.** A change that touches `ccd/` — the hook
script in particular — must ship to the fleet host *before or with* the server,
because the server reads what the hook writes. Shipping a server that expects a
newer envelope shape to a fleet still running the old hook is how you get a
confident UI over stale data. A server+PWA-only change has no such constraint.
`ccd ws-rename` is the same rule with a sharper edge: the naming lane calls it
unattended, and `ccd caps` has advertised the verb since long before it took
flags — so a server deployed ahead of its ccd sees the verb gate pass and the
call fail. One attempt per workspace, absorbed by the lane's retry guard, and
zero if the agent ships first.

**Restore** (manual, from the target box — pick the `<ts>` to roll back to):

```bash
# fleet host (agent target)
cp -a ~/ccrc-backups/<ts>/ccd ~/.local/bin/ccd
cp -a ~/ccrc-backups/<ts>/notify.sh ~/.cc-sessions/notify.sh
cp -a ~/ccrc-backups/<ts>/session-hook.sh ~/.cc-sessions/session-hook.sh
cp -a ~/ccrc-backups/<ts>/agent-dist/. ~/ccrc/agent/dist/
systemctl --user restart ccrc-agent.service
# server box
cp -a ~/ccrc-backups/<ts>/dist-pwa/. ~/ccrc/server/dist-pwa/
systemctl --user restart ccrc.service
```

## Remote fleet mode

By default (`CCRC_FLEET=local`, unset) the server reads ccd's flat files and
shells out to `ccd`/`tmux` directly on its own box. `CCRC_FLEET=remote`
instead drives the fleet through `ccrc-agent` running on a separate fleet
host, over a single authenticated WebSocket — the server never SSHes into
the fleet box at runtime.

**`remote` is what's actually deployed, and has been** — `GET
/api/fleet/health` answers `{"mode":"remote"}` on the live server, not
`local`. The consequence this whole build rests on: **the server and the
fleet host are different boxes**, and the link between them is read-only for
files except `.cc-clips` (every other mutation crosses it as a whitelisted
`ccd`/`tmux` verb, never a raw write). The coordinator's dispatch/close
routes and the mail delivery lane all reach ccd through this same seam —
see "Fleet coordination" below.

### Config

| Var | Where | Meaning |
| --- | --- | --- |
| `CCRC_FLEET` | server | `local` (default) or `remote`. |
| `CCRC_AGENT_URL` | server | `ws://`/`wss://` URL of `ccrc-agent` on the fleet host, e.g. `ws://100.x.x.x:7789`. |
| `CCRC_AGENT_TOKEN` | server + agent | Bearer token; must match on both sides. Generate with `openssl rand -hex 32`. |
| `CCRC_HETZNER_TOKEN` | server | Hetzner Cloud API token — only used by the degraded-mode reboot action. Unset leaves that route disabled (`501`). |
| `CCRC_FLEET_SERVER_ID` | server | Hetzner Cloud server ID of the fleet host — only used by the reboot action. |
| `CCRC_AGENT_HOST` | agent | Bind interface, default `127.0.0.1`. Never `0.0.0.0` — bind the tailnet address explicitly instead. |
| `CCRC_AGENT_PORT` | agent | Listen port, default `7789`. |

See `deploy/ccrc.env.example` and `deploy/ccrc-agent.env.example` for
copy-paste templates.

### Agent security model

`ccrc-agent` (`agent/`) is deliberately narrow — it is not a
general remote-shell:

- **Network**: binds a single interface (tailnet-only by convention; default
  `127.0.0.1`), never `0.0.0.0`. Every connection must send a valid `hello`
  frame with the bearer token within 3 s, or the socket is closed; a wrong
  token closes with code `4401`.
- **Exec whitelist**: only `tmux` (`has-session`, `list-panes`,
  `capture-pane`, `send-keys`, `resize-window`) and `ccd`, matched against the
  exact bare command name (no path components) and an argv **prefix** — most
  `ccd` verbs are still a bare first token (`start`, `enable`, `ensure`,
  `stop`, `swap`, `ws-add`), but several now require a longer prefix before
  anything after it is unconstrained: `pr-state` needs `--session` or
  `--project`, `pr-open`/`ws-archive`/`ws-restore`/`ws-audit`/`ws-attic`/
  `ws-hold`/`ws-release`/`ws-rename` need `--session`, and `ws-reap` needs
  `--expect` — a load-bearing confirmation token, so an unconfirmed reap can
  never cross the wire at all. `ws-rename`'s flag guards a different hazard:
  the verb destroys nothing, but it is the first whose argv the server builds
  from model output (`FleetWatcher`'s naming sweep) and sends with no human
  anywhere in the path — a bare `['ws-rename']` would still permit the whole
  positional argv surface the verb used to have, so naming the flag is what
  keeps the grant two tokens wide. `clip` and the legacy, unguarded `ws-rm`
  are gone; `ws-gc` (which would permit `--prune`) was never granted. `gh`
  has no entry, deliberately: the host token carries the `repo` write scope
  and there is no read-only credential or cwd sandbox, so any `gh` grant
  would make this list the sole control between the PWA and `gh pr merge` —
  the one PR write goes through a `ccd` verb instead. Anything else comes
  back `{ok:false, err:'forbidden'}`.
- **Path whitelist**: every file op resolves the target through `realpath`
  and checks it's still under an allowed canonical prefix — closing the
  classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
  `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), and the
  fleet's projects root. Writes: `$HOME/.cc-clips/` only.
- **pty**: `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>`, with
  `sessionId` sanitized to `[A-Za-z0-9_-]+` — never an arbitrary command.

### Degraded mode

While the fleet host is unreachable in remote mode, the server keeps serving
the last-known-good fleet snapshot instead of going blank:

- On every successful full fleet poll, the snapshot is written atomically to
  `~/.ccrc/state-cache.json` on the **server's** box (this file never goes
  through the agent — it's local housekeeping, same as the PWA dist-check).
- When the agent connection drops, `GET /api/fleet` keeps serving that cached
  snapshot with `stale: true` and `downSince: <epoch ms>`; the PWA shows a
  banner ("Fleet host unreachable since …") once it sees `stale`.
- `GET /api/fleet/health` → `{mode, connected, downSince}` — poll this to
  check remote-mode connectivity (`mode: 'local'` always reports
  `connected: true`).
- `POST /api/fleet/reboot` fires a Hetzner Cloud reboot of the fleet host —
  the PWA's confirm dialog names the collateral (it also restarts the
  rp-llm services sharing that box). Guards: `409` if `mode !== 'remote'`,
  `501` if `CCRC_HETZNER_TOKEN`/`CCRC_FLEET_SERVER_ID` aren't set, `502` on a
  Hetzner API error, `202` on success.

### Verifying a remote-mode deploy

After `deploy.sh agent <host>` and flipping the server to `CCRC_FLEET=remote`:

```bash
curl -fsS http://203.0.113.7:7788/api/fleet/health   # {"mode":"remote","connected":true,"downSince":null}
```

Then kill/stop `ccrc-agent` on the fleet host and re-poll — `connected`
should flip to `false`, `/api/fleet` should keep returning the last snapshot
with `stale: true`, and the PWA banner should appear; restart `ccrc-agent`
to restore `connected: true`. `CCRC_FLEET=remote` is not a hypothetical
cutover — it is the live server's actual, standing configuration (see
"Architecture" above), so this drill exercises the degraded-mode path a real
agent restart or network blip already produces, not a one-time migration.

## Fleet coordination

Build 7 turns a program into a live, server-observed thing: `~/.ccrc/coord.db`
holds programs, runs, work items, mail and coordinator state (SQLite, opened
with `node:sqlite`'s `DatabaseSync`, WAL mode, `user_version` migrations that
refuse to start rather than open empty — a bad migration errors loudly
instead of silently starting a program's history over). ccd's flat files —
the registry, the hold, `.prhistory` — stay the fleet's own ground truth; the
database is a server-side re-measurement of what they already say, never a
replacement for them, and a lost `coord.db` reconstructs from them.

**Run lifecycle**, three HTTP routes driving six steps, one run row per wave
(D-56, corrected — the version below was checked line-by-line against
`server/src/coord/routes.ts`, not written from the route names alone):

1. `POST /api/runs` opens a run row for one wave — **the ledger is NOT
   written or read here** (the route's own docstring says so verbatim); it
   only names `docs/superpowers/programs/<slug>.md` in the response, so a
   coordinator that forgot to commit it is told once, in the place it would
   notice. A second coordinator on the same program is refused. Wave 1 (no
   `sessionId` in the body) places **no hold yet** — dispatch is what claims
   the workspace. Wave N≥2 (`sessionId` names the workspace being reclaimed)
   holds it immediately (`ccd ws-hold`).
2. `POST /api/runs/:id/dispatch` checks `$REG/coordinator-paused` and both
   caps **before spawning or resuming anything**; wave 1 (`run.sessionId`
   still null) runs `ccd ws-add` and learns the new session id by diffing
   the registry before/after (never ccd's own echoed sentence, and never
   `ccd start` — no ccd verb of that name runs anywhere in this lane). Wave
   N≥2 resumes the *same* workspace with `ccd ensure` (the harness resumes
   its own transcript) and then discards that resumed context with an
   injected `/clear` through `sendPrompt`'s full proof discipline, so
   "genuinely fresh context" stays mechanical rather than hoped for. Either
   path ends in `ccd ws-hold` and the transition to `dispatched`; only once
   that commits does the wave brief go out as mail, into a context proven
   empty (wave 1) or proven `/clear`-verified (wave N≥2).
3. The coordinator watches mail and `pr-state` the way an operator would —
   `GET /api/runs` and the `runs` frame on `/ws/fleet` carry state and
   work-item tallies, nothing new to poll.
4. A worker's done-claim is **re-measured, never believed**: branch tip,
   handoff commit, PR number and phase are all read fresh off git's own ref
   files and `.prhistory`, not trusted off the claim body — a stale tip, a
   regressed PR, or a handoff commit that isn't the claim's own branch tip
   is refused and mailed back with the reason. (An explicit abandon,
   `state:'failed'`, skips this re-measurement entirely — there is no
   worktree left to re-measure an abandon against.)
5. The coordinator reviews the handoff commit like any other diff — brief
   *quality* stays discipline, not something this server enforces — then
   closes **this** run non-finally (`POST /api/runs/:id/close`,
   `final:false`, `state` defaulting to `'done'`): that re-holds the same
   workspace under the wave-N+1 reason and drives *this* run row to a
   terminal `done`/`failed` (`RUN_TRANSITIONS` gives `done`/`failed` no
   edges out — the row itself never dispatches again). Wave N+1 is a **new**
   run: a second `POST /api/runs`, naming the same `sessionId`, back to
   step 1 — then step 2's dispatch again, on the new run's id.
6. `POST /api/runs/:id/close` with `final:true` releases the hold (`ccd
   ws-release`); the ordinary merged-and-unheld sweep archives it on its own
   clock. An explicit abandon (`state:'failed'`) alone still only
   *releases*, exactly like a normal final close — archiving instead needs
   `archive:true` passed explicitly (the one call in this whole lane to
   `ccd ws-archive`, mirroring the manual archive route including its 501).
   **Caution:** `state:'failed'` with `final:false` and no `archive`
   re-holds the workspace under the *next* wave's reason even though this
   run just went terminal — abandoning mid-program needs `final:true` or
   `archive:true` explicitly, or the workspace stays held for a wave that
   is never coming.

**The mail bus and its token.** Sessions send each other mail — `finding |
question | answer | status | artifact` — through `POST /api/mail`, attributed
(`{fromId, fromUuid}` checked against the live registry: freshness, not
forgery-proofness) and capped (an 8 KiB body, typed rejection codes, every
rejection itself recorded, win or lose). A watcher lane (`MAIL_SWEEP_MS`,
10 s) walks queued deliveries and, once a recipient has been idle-quiet for
`MAIL_QUIET_MS` (60 s) with no dialog or ask pending, injects the fenced
envelope through `sendPrompt`'s full proof discipline — never re-rendered,
replayed verbatim on later sweeps (after a per-session `MAIL_COOLDOWN_MS`,
and again every `MAIL_REPLAY_MS`) until the recipient POSTs
`/api/mail/:id/ack`.

`/api/mail` (and its ack route), the run routes (`POST /api/runs`,
`/:id/dispatch`, `/:id/close`, `/:id/advance`), `GET /api/mail?to=<id>` and
`/api/notify` (ccd's swap hook) all require the same **box token** — one
shared secret per box, read from a file, deliberately never an env var
(`deploy/ccrc.service` ships no `EnvironmentFile=`, and this build does not
add one, to avoid flipping a live unit's environment blind). It lives at
`~/.cc-secrets/ccrc-mail.token` on the **fleet host** (read by
`deploy/notify.sh`) and at `~/.ccrc/mail.token` on the **server**
(`CCRC_MAIL_TOKEN_PATH` to override); both are shipped from one
locally-gitignored `deploy/ccrc-mail.token` (`openssl rand -hex 32` to mint
it, or `cp deploy/ccrc-mail.token.example deploy/ccrc-mail.token && edit`)
by `deploy/deploy.sh`'s secret-shipping lane. **The run routes were
unauthenticated for a stretch of this build's own history** — an earlier
design note argued they were no worse than the pre-existing, also-open
`/api/sessions/*` surface — but a whole-branch review found that posture
inverted the intent (`ccd ws-add`, an injected `/clear` and
`ws-release`/`ws-archive` are strictly more dangerous than inserting a mail
row, which required the token all along) and closed it: every coordinator
write route now fails the same way the mail pair always has. None of these
six routes tolerates a missing token — a request with none is `401
unauthenticated`, full stop. `/api/notify` alone accepts a request with
**no** token header for one deploy generation, logged as `legacy` so the
swap hook cannot go dark mid-rollout; that tolerance comes out in the deploy
*after* the one that ships `notify.sh`'s token read — it is a rollout
bridge, not a standing policy. **Minting the token file matters as much as
having one:** `deploy/ccrc-mail.token.example`'s own placeholder value line
must actually be replaced — copying the example verbatim is refused loudly
at server boot (`MailTokenPlaceholderUnedited`), not silently accepted,
because that exact placeholder is committed to this public repo.

**Caps and pause.** The single-row `coordinator_state` table holds
`maxConcurrentWorkers` (default 3 — runs currently dispatched and not yet
terminal) and `maxSessionsPerDay` (default 12 — dispatches inside a rolling
24h window, not a calendar day), both checked at
`POST /api/runs/:id/dispatch` before anything else is touched. No route in
this PR changes them; until PR J adds one, an operator edits the row
directly: `sqlite3 ~/.ccrc/coord.db "UPDATE coordinator_state SET
maxConcurrentWorkers=…, maxSessionsPerDay=… WHERE id=1"`. Pause is a
**file**, on ccd's own `*-disabled`-marker convention, read from `$REG`
(the fleet host's session registry, `~/.cc-sessions`) before every dispatch:
`touch $REG/coordinator-paused` refuses every dispatch with `409
refused:paused`; `rm` it to resume. There is no verb or route that can
unpause the coordinator from the API or the PWA — a pause always traces back
to a human at a terminal, on purpose. Mail delivery has the identical
kill-switch on the same pattern: `touch $REG/mail-disabled` stops the sweep
from injecting anything (queued mail waits, nothing is lost); `rm` it to
resume. Dispatch honours this marker too, not only `coordinator-paused` — it
refuses outright (`409 refused:'mail-disabled'`) rather than resuming a
worker and injecting `/clear` into a context whose wave brief would then sit
held by the very kill-switch the operator just raised.

**The honest boundary.** The coordinator acts through this server's HTTP
API — one recorded chokepoint for every irreversible act (dispatch, close,
mail) — and that chokepoint is what makes the caps and the pause file real
controls rather than suggestions. But raw ccd remains physically possible:
every session on the fleet host shares one UNIX user, ccd has no caller
auth, and any session can already run any verb directly. Nothing
server-side stops that. The single recorded chokepoint is a contract the
coordinator's skill honors, not a wall the OS enforces — the same "identity
is attribution, not authentication" stance the mail bus already states for
who a message claims to be from.

## Live end-to-end tests

Drive a throwaway `claude2-cctest` session on the box through the public API:

```bash
CCRC_BASE_URL=http://203.0.113.7:7788 \
  npx vitest run --config vitest.e2e.config.ts        # in server/
```

The suite is `CCRC_BASE_URL`-gated, so a bare `vitest run` stays hermetic.
Reset cctest between runs: stop `claude-session@{claude2,claude}-cctest` and
`rm ~/.cc-sessions/{claude2,claude}-cctest.*`.

## Pane-format fragility (re-capture after Claude Code upgrades)

Hooks now carry a session's *state* (above), which removed the worst of this —
but the pane is still scraped, and two jobs genuinely need it: reading the
input-box draft, and proving that the menu on screen is the one an answer is
about. Both drift between Claude Code versions. After any upgrade, re-capture
the fixtures under `server/test/fixtures/panes/` (e.g.
`tmux capture-pane -t cc-<id> -p`) and re-run `test/dialog.test.ts` /
`test/send.test.ts` / `test/ask-route.test.ts`.

Hook *delivery* drifts too, and silently: Claude Code 2.1.222 delivers
`AskUserQuestion` as a `PermissionRequest`, not the `PreToolUse` the mapping was
originally written against. Both arms are kept and both are pinned by tests,
because which one fires is a harness detail this repo cannot predict across
upgrades. After an upgrade, check that a real question still writes
`ask.questions` and not an empty `ask.approval`.

Known real-format subtleties already encoded:

- The **input box** is the LAST `❯` line (history turns render `❯ ` above it),
  and the empty box uses `❯` + a **U+00A0 non-breaking space**, not a plain one.
- A `--remote-control` pane **never renders `esc to interrupt`**, so busy-ness is
  taken from the live status file (`sessions/<pid>.json`), not the pane.
- Real **AskUserQuestion** menus put a description line under each option and can
  split the list across a `───` rule — options are not adjacent.

Anything the parser can't handle degrades to `parsed:false` / the terminal
drawer rather than crashing.
