# Named workspaces, and a Linear ticket at session start (design)

**Status:** approved by the operator on 2026-10-20, with the prototype. Rev 1. Nothing in it is built yet. §9's
three questions are answered: O1 and O3 as recommended, and O2 by the operator's own ask that renaming an
existing workspace is part of this delivery.

**Date:** 2026-10-20 · **Base:** `origin/main` `63fc3152` (#940). Every anchor below was read on that commit,
read-only. Nothing on a fleet or server box was touched or measured for this document.

**Prior work:** `docs/superpowers/plans/2026-08-31-subagent-preview-and-ticket-named-workspaces.md`, Feature B
(stages B1–B7), built on the branch `feat/ticket-named-workspaces` and never merged. That branch is 566 commits
behind `main` and carries a second, unrelated feature (the subagent preview, Feature A). This design keeps what B
measured and re-plans it for today's `main`; the branch stays untouched as the only copy of Feature A. Its two
Feature B deviations, D-2462 (`_ws_slug_valid`'s undocumented two-character floor) and D-2463 (`_ws_slug_new`'s
overloaded rc 1), are cited here, not redefined.

**Plan:** to be written after this design is approved; deviations are issued by `POST /api/ledger/deviations`
at that time.

## In short

The operator wants two things:

1. **Name a workspace.** Today every new workspace gets a random `adj-noun` slug (`ccd/ccd` `_ws_slug_new`
   ≈:6639), and ten seconds after its first turn the ai-title sweep renames its branch anyway
   (`server/src/watch.ts` `sweepNames` ≈:3718). Nothing lets a human choose, and nothing protects a choice.
2. **Paste a Linear link or ticket id when opening a new session,** and get a workspace named after the ticket.

The design:

- **One field, two doors.** A single control, *Name or Linear ticket*, appears in the new-session sheet (after the
  project) and in the sheet that the project card's `+` now opens. Same component, same server route, same rule.
- **Empty means today, exactly.** An empty field in the new-session sheet sends today's request and runs
  `ccd enable` on the project's main checkout. An empty field behind `+` sends today's bodyless `ws-add`.
- **Filled means a named workspace.** The session is created by `ccd ws-add` with an operator slug, a display
  title, and — from the new-session sheet — **the account the operator picked**, which needs one new ccd flag
  (`--wrapper`, §4.1).
- **Two strings, not one.** The slug (`eng-1234-fix-the-login-flow`, ≤31 chars, immutable) names the directory,
  the branch `ws/<slug>` and the session id. The title (`ENG-1234 - Fix the login flow`) is what the board shows.
- **Linear is connected in Settings.** The operator pastes a Linear API key on the Settings screen; the server checks
  it against Linear before keeping it, stores it in one `0600` file, and never sends it back. No environment
  variable and no deploy step (§5.1).
- **Linear is a lookup, never a gate.** With Linear connected, the server fetches the issue's real title,
  and the sheet shows it before the operator taps Start. Without a token, or on any failure, the ticket still
  parses offline and the workspace is still created.
- **A human's name is final.** A workspace named by the operator is exempt from the ai-title sweep.
- **Renaming later changes the title only.** A *Rename* action on a workspace sets or clears its title; the slug
  never changes (§6).

## 1. What is true on `main` today

### 1.1 Two doors, neither nameable

| door | PWA | route | argv | ccd | worktree | account |
|---|---|---|---|---|---|---|
| New session (FAB, palette) | `NewSessionSheet.tsx`: account → project → optional route row (:292–399) | `POST /api/sessions` (`server.ts` ≈:2782) | `CCD_ARGV.enable` (`ccdargv.ts` ≈:264) | `cmd_enable` → `cmd_start` (≈:28155, :24222) | **none** — the project's main checkout (≈:24341) | **chosen** |
| Project card `+` | `ProjectCardHead.tsx` ≈:168 → `useProjectRows.addWorkspace` (≈:285) | `POST /api/projects/:project/workspaces` (≈:2866) | `CCD_ARGV.wsAdd` (≈:394) — never a slug | `cmd_ws_add` (≈:6966) | `ws/<slug>` | **automatic** (`_place_for_class` → `_ws_least_loaded`, ≈:7102) |

- `cmd_start` has no name argument; its id is always `<wrapper>-<project>` (≈:24276). It cannot be named.
- `cmd_ws_add` already accepts an optional slug positional (`project="${1:?…}" slug="${2:-}"`, ≈:7067), validates
  it (`_ws_slug_valid`, ≈:6392: `^[a-z0-9][a-z0-9-]{1,30}$`) and refuses a taken one (`_ws_slug_free` +
  `_ws_slug_git_state`, ≈:7242). Only coordinator dispatch passes one (`wsAddWorker`, `ccdargv.ts` ≈:473).
- `cmd_ws_add` has **no flag that chooses the account**. Placement is least-loaded, optionally filtered by
  `--route class=` (strict).

### 1.2 Names on the board

- `FleetSession` has `workspace` (slug), `branch`, and `name` — the display name a human gave *inside Claude Code*
  (`shared/api.ts` ≈:91–106). No ccd-written title exists.
- `sessionLabel` is `name ?? branch ?? workspace ?? id` (`pwa/src/fleet/sessionLabel.ts` ≈:29).
- `sweepNames` renames `ws/<slug>` to `ws/<ai-title slug>` for any unclaimed, unheld workspace whose branch is still
  its birth branch (≈:3742–3744). **Nothing exempts a hand-named row.**

### 1.3 Linear

No Linear client, token or URL exists on `main` (the one hit is test data in `topology-clean.test.ts`). The
optional-token pattern to follow is `CCRC_HETZNER_TOKEN`: `string | null` in `config.ts` (≈:168, :471), checked at
use time, documented as an empty key in `deploy/ccrc.env.example`.

## 2. The user flow

### 2.1 New-session sheet

```
Account   [ lane-a  62% free ]                     (step 1, unchanged)
Project   [ project-a          ]                     (step 2, unchanged)
Name or Linear ticket   [ ENG-1234                  ]   ← new, optional, no autofocus
          ↳ ENG-1234 - Fix the login flow             ← resolved title (or the offline one)
          ↳ new workspace  project-a-eng-1234-fix-the-login-flow
Routing   Class · Effort · Workflows                   (unchanged)
[ Start ENG-1234 on lane-a ]                           ← the confirm narrates what will happen
```

- **Empty field:** the confirm reads as today ("Start project-a on lane-a") and sends today's body byte for byte.
- **A project from the other pool** (the sheet's crossing pick): the field is disabled with one line, *Named
  workspaces start in this account's own pool*, because `ws-add` has no cross-pool path and `_pool_ok` would refuse.
- **An account a workspace cannot start on** (an overflow lane the picker still offers for `ccd start`): the same,
  with *Workspaces don't start on overflow accounts*.
- **Filled field:** the confirm names the workspace ("Start ENG-1234 on lane-a"). A one-line note under the field
  says what changes: *Creates a new workspace on its own branch instead of using the main checkout.*
- **Refused input** (`!!`, one character): the field shows the refusal in words and the confirm is disabled.
  Nothing is sent.

### 2.2 Project card `+`

`+` opens a small sheet instead of creating at once — the decision the old plan already took, for the same
reasons: the create is irreversible and the slug is chosen for life. The sheet holds the same field, a line
stating where it will land (*Lands on lane-b — 71% free*, from `addWorkspaceLabel`, `placementWords.ts` ≈:76), and
the confirm. **Two taps for the auto-named path** (`+`, then *Add workspace*), no keyboard: the field never
autofocuses (the sheet spec's ruling, `2026-10-20-sheet-desktop-arm-…-design.md` row (a)).

### 2.3 What the board shows

`sessionLabel` gains a first rung: `title ?? name ?? branch ?? workspace ?? id`. The card reads
**ENG-1234 - Fix the login flow**, with the slug where it already appears for a workspace.

## 3. Parsing a name (L0, `shared/slug.ts`)

Ported from the branch (B3), which copies cleanly: `main`'s `_ws_slug_valid` is byte-identical to what it was
written against.

| input | kind | slug | offline title |
|---|---|---|---|
| *(empty)* | auto | — (ccd draws one) | — |
| `ENG-1234` | ticket | `eng-1234` | `ENG-1234` |
| `https://linear.app/<team>/issue/ENG-1234/fix-the-login-flow` | ticket (URL) | `eng-1234-fix-the-login-flow` | `ENG-1234 - Fix the login flow` |
| `user/eng-1234-fix-the-login-flow` (Linear's copy-branch form) | ticket (branch) | `eng-1234-fix-the-login-flow` | `ENG-1234 - Fix the login flow` |
| `Login cleanup` | plain | `login-cleanup` | `Login cleanup` |
| `!!` / `a` | refused | — | — (`empty-after-slugify` / `too-short`) |

Rules kept from B3 and its review round:

- The slug budget is 31 and the floor 2, matching `_ws_slug_valid` (D-2462). A trailing `-` is stripped **after**
  truncation. A long ticket title cuts to a short slug and keeps its full sentence as the title.
- A **parity test reads the regex out of `ccd/ccd`** at test time, so a ccd grammar change reds the suite instead
  of shipping slugs the box refuses.
- **The operator's own words win.** A plain name that happens to look like an id (`demo-2`) keeps the operator's
  words as its title unless Linear actually returns an issue for it; only a pasted URL, whose text is not words
  the operator typed, takes the parsed title.
- Refusal reasons are a `Record<Reason, string>` with the runtime list derived (`Object.keys`), each asserted
  separately in tests.
- **The title cap is ccd's, not a new number.** `WS_TITLE_MAX_BYTES` is defined as `LC_REASON_MAX_BYTES`
  (`shared/api.ts` ≈:8731), measured in UTF-8 bytes because `_lc_dec_ok` runs under `LC_ALL=C`.

## 4. The seam

### 4.1 ccd (AGENT-FIRST)

`cmd_ws_add` gains two flags in its existing strip loop, each mirroring `--actor`'s **current** shape (at most
once, non-blank, no control characters, `_lc_dec_ok` length bound):

- `--title <text>` — written as the registry field `title`.
- `--wrapper <name>` — **new in this design.** Placement is skipped and the session lands on that account. The
  account must be **home-able** (`_is_home_able` — a workspace never starts on an overflow lane, the same set
  `_ws_least_loaded` walks), pass `_account_ok` and `_pool_ok`, and, **only for an explicit `--route class=`**,
  pass `_class_gate` with no rung-below degrade. An auth-dead (condemned) lane is refused: the operator picked it
  by name, and placing on it silently is the fallback O1 rules out. Any failure **refuses** with the same per-lane
  reason words the no-placement message already builds (extracted into one helper both callers use), before any
  worktree exists. It never falls back to another account (O1).
- **The post-worktree step honours the pick.** `cmd_ws_add` re-takes its placement after the worktree exists
  (≈:7343, "THE PICK IS RE-TAKEN HERE, AND NOT MERELY RE-VALIDATED"). With `--wrapper` that step re-validates the
  named lane against the fresh roster instead of re-picking, and dies with its existing "worktree EXISTS" message
  if the lane no longer qualifies. Re-picking there would overwrite the operator's choice with the least-loaded
  lane.

And one registry field: `named=1`, written **only when `--title` was given** — the operator's door always sends
one. It is *not* keyed on the slug alone: coordinator dispatch passes a slug too (`wsAddWorker`,
`server/src/coord/dispatch.ts` ≈:670), and keying on the slug would exempt every dispatched worker from the sweep
for life. A failed `title`/`named` write warns the way the `--child` write does (≈:7418), because a silent failure
leaves a human-named workspace open to the sweep.

Both flags are advertised in `ccd caps` (`ws-title-v1`, `ws-wrapper-v1`). **The server sends neither to a box that
does not advertise them**, and `wsAddNamed` places both flags **before** the project, as `--no-rc` and `--route`
already lead. An older ccd's strip loop binds an unknown token as a positional (D-6113): leading, `--title` lands
in the project or slug slot and is refused by `_ws_project_valid` or `_ws_slug_valid`; trailing, after
`project slug`, it would be dropped unread and the workspace created on the least-loaded lane with exit 0. So the
caps gate is the control, and the leading position is the defence behind it.

### 4.2 Server

- `CCD_ARGV.wsAddNamed(project, slug, {title, wrapper}, route, dec)` — a **new key**, never a widened `wsAdd`:
  `whitelist-subset.test.ts`'s key equality fails on a new key and not on a widened optional. It carries `route`
  and `dec` like `wsAdd` does, so a named create keeps the class route and the device actor (D-5301).
- **One route serves both doors:** `POST /api/projects/:project/workspaces`, body
  `{route?, name?, wrapper?}`. The new-session sheet calls it when its field is filled.
  - no `name` → today's `wsAdd`, today's response, unchanged (the additivity proof);
  - `isWsProject(project)` false → 400 `bad-project` **before any argv exists** (the argv-smuggling defect the old
    review found: `POST /api/projects/--no-rc/workspaces` let ccd's strip loop eat the flag);
  - name refused → 400 `bad-name` with the reason, **no argv built**;
  - `wrapper` given without `WS_WRAPPER_CAP` → 501 `unsupported` (the existing word for a ccd verb or flag the box lacks); `name` without `WS_TITLE_CAP` → 501;
  - a blank name **omits** the slug token, never sends `''` (`['ws-add','demo','']` draws a random slug and
    exits 0, so the route would answer 200 for a workspace nobody named);
  - ccd stderr `slug in use: ` → 409 `slug-taken` (the sheet stays open with the field intact);
    `invalid slug '` → 400; a `--wrapper` refusal → 409 `account-refused` with ccd's reason; anything else → 502.
  - success → `{ok, id, slug, title}`.
- **Linear lookup** (`server/src/linear/client.ts`, ported from the branch's B4): a `POST` to Linear's GraphQL
  endpoint, its origin and path held as two constants so no tracked file spells the host and path together (the
  public-tree scanner `topology-clean.test.ts` refuses that shape), `Authorization: <token>` with **no** `Bearer`, `issue(id:"ENG-1234"){identifier title}`, an 8 s
  `AbortSignal` deadline. Five distinct failure arms (not-configured, unauthorised, not-found, timeout,
  malformed); every one degrades to the offline title and never blocks the create.
- **A Linear title over the byte cap is shortened, never refused** — the branch's latent gap: `titleFits` ran
  after the lookup, so a long issue title would have turned a lookup into a 400.
- **The create resolves too.** When a name parses as a ticket, the route looks it up with the same client and the
  same deadline, so the created title matches the preview whenever Linear answers. Every failure arm degrades to
  the offline title, and the create proceeds.
- **A Linear title is sanitised before it reaches ccd:** control characters collapse to one space and the result is
  trimmed, then shortened to the byte cap with `…`. ccd refuses a control character in `--title`, so an
  unsanitised issue title could otherwise turn a lookup into a 502.
- **Preview read:** `GET /api/linear/resolve?ref=<text>` returns `{kind, slug, title, source: 'linear' |
  'offline', reason?}` so the sheet can show the real title before the operator commits. Session-gated like every
  PWA read; no box token. The PWA debounces it (400 ms) and treats any failure as "show the offline title".
- **The key comes from the connection file, read at use time** (§5.1), not from the environment. The branch's
  `CCRC_LINEAR_TOKEN` config field and its `ccrc.env.example` block are **not** ported: one writer (the Settings
  route) and one source (the file), so a key can never be set in two places that disagree.

### 4.3 Wire and registry

- `SessionRecord.title` and `SessionRecord.namedByOperator` (`server/src/registry.ts`). A `named` file that is
  listed but unreadable reads as **named**: the cost of guessing wrong the other way is a model typing over a
  human's name (`held`'s ruling). The registry read census (`buildRecordFieldReadCount`) grows by two, and every
  `[registry-read-census:fields]` claim moves with it.
- `FleetSession.title: string | null`, additive, no `FLEET_PROTO` bump, revived through `reviveFleetSession`.
- `sweepNames` skips a row with `namedByOperator` — one clause beside the `held` check (≈:3772), before the
  `openRunsForSession` query.

## 5. The PWA

- **`WorkspaceNameField`** — one component (input, derived preview, Linear title, refusal text), used by both
  sheets. It renders and disables; it **never rewrites what the operator typed**. It imports the same
  `deriveWorkspaceSlug` the server validates with.
- **`NewSessionSheet`** gains the field after the project step. Filled → `api.workspaceAdd(project, {name,
  wrapper, route})`; empty → today's `api.createSession`. The route row applies to both.
- **`AddWorkspaceSheet`** (new, on `@ccrc/ui`'s `Sheet`) replaces `+`'s instant create, mounted at screen level
  beside the other sheets, never inside the card. Wired through `useProjectRows.addWorkspace`, keeping its class
  filter and `refreshProjects`.
- `api.workspaceAdd(project, {route?, name?, wrapper?})` — an options object; `name` is sent only when non-blank.
- Tests use `fireEvent`, not `userEvent` (vaul's drag handler raises unhandled errors under `userEvent`'s pointer
  sequence — measured on the branch).

### 5.1 Settings → Linear

The operator's ruling (2026-10-20): "the whole connection must be in Settings". A **Linear** section on the
Settings screen, beside the box-token section it is modelled on:

| state | what the section shows | actions |
|---|---|---|
| not connected | *Not connected. Paste a personal API key from Linear's settings (read access is enough).* | key field, **Connect** |
| connected | *Connected to **team-a** as **user-a** · key ending `…4f2c` · checked 3 min ago* | **Check again**, **Disconnect** |
| key rejected | *Linear rejected this key (it was revoked or expired). Ticket titles fall back to what you paste.* | key field, **Replace key**, **Disconnect** |
| unreachable | *Couldn't reach Linear at the last check. Ticket titles fall back to what you paste.* | **Check again**, **Disconnect** |

- **Connect verifies before it stores.** `PUT /api/linear/connection {key}` asks Linear `viewer { name }
  organization { name }` with the 8 s deadline. A key Linear rejects is answered 400 `key-rejected` and **never
  written**; an unreachable Linear is 503 `unreachable` and also not written, so the file only ever holds a key
  that worked once.
- **Storage:** `~/.ccrc/linear.key`, written with `writeValueFileAtomic` and read with `readValueFile`
  (`server/src/token/files.ts`) — the box token's own atomic `0600` writer and measured reader, not a second
  mechanism. Beside it, `~/.ccrc/linear.json` holds what the section displays (organisation and user names, the
  key's last four characters, the last check's time and outcome). The key itself never leaves the server: no route
  returns it, no log line carries it, and the child-process env scrub that keeps `CCRC_HETZNER_TOKEN` away from
  account operations (`server/src/accounts/ops.ts` ≈:22) is irrelevant because the key is never in the
  environment.
- **Routes**, all PWA-surface, none exempt and none box-token gated: `GET /api/linear/connection` (the table's
  state, never the key), `PUT /api/linear/connection`, `POST /api/linear/connection/check`,
  `DELETE /api/linear/connection` (removes both files).
- **A key is a credential, and its writes get the credential posture.** `PUT` and `DELETE` go through the account
  gate (`server/src/accounts/gate.ts`, `createAccountGate` with `stepUp: true`): refused while auth is unarmed,
  refused from an insecure origin, and behind a recent step-up — the same stance every account credential write
  already takes (D-5511, D-5512). A read-only third-party key does not earn a weaker one: an unauthenticated
  caller who can `PUT` can point ticket titles at an organisation the operator never chose.
- **The key's shape is checked before Linear is called:** `^[A-Za-z0-9_-]+$` and a length cap. A key with
  whitespace, a leading `#` or a newline would be stored differently from how it was verified (`readValueFile`
  takes the first non-comment line and strips whitespace), or make `fetch` throw and be reported as
  *unreachable*. Such a key is 400 `bad-key`.
- **Every read kind is mapped:** `readValueFile`'s `absent`, `unreadable`, `unusable` and `placeholder` each have a
  state; `linear.json` gets its own measured JSON reader (absent, unreadable, malformed kept apart). The key is
  written first and deleted first, so a crash between the two writes leaves *key present, details absent*, which
  the section shows as *connected, details unknown — Check again*.
- **Error bodies carry fixed words, never Linear's text**; all four routes answer `Cache-Control: no-store`; no log
  line carries the key or a response body.
- **An unreadable key file** (it exists, but EACCES) is its own state, *Can't read the stored key*, not
  *not connected* — `readValueFile` measures the difference and the section must not fold it.
- **A lookup that gets 401** from Linear marks the connection *key rejected*, so the Settings screen tells the
  truth the next time it is opened, without a separate poller. It marks it **only if the stored key is still the
  one that was used** (compared by digest): a 401 from a key the operator has just replaced must not condemn the
  new one.
- The new-session sheet and Rename show a one-line link *Connect Linear in Settings to fetch ticket titles* while
  not connected, and nothing once connected.

## 6. Renaming an existing workspace

The slug is immutable for life (directory, branch, session id, unit, tmux name all derive from it). What an
operator usually means by "rename" is the label, so:

- **Session actions → Rename** opens the same field, pre-filled with the current title. Saving sets `title` and
  `named=1`; clearing removes both, which returns the workspace to the ai-title sweep.
- ccd: `ws-title --session <id> (--title <text> | --clear)` — a narrow verb that writes two registry fields and
  nothing else. It is a **workspace-lifecycle** mutation, not coordination, so the "zero new ccd verbs for
  coordination" rule does not bind it. It needs a gated grant (`['ws-title','--session']` plus its
  `REQUIRED_VERB_FLAG` entry in `agent/src/whitelist.ts`), and the server offers Rename only when `ccd caps` lists
  the **verb** `ws-title` — not `ws-title-v1`, which S1 advertises for `ws-add --title` before the verb exists.
- A Linear ticket pasted into Rename resolves the same way, so a workspace started without a ticket can be tied to
  one later. The branch is not renamed.

This stage is **in scope** (the operator's ruling on O2). It ships last and alone, and the rest of the design
does not depend on it. Rename is offered on every workspace row, auto-named ones included. A main-checkout
session has no workspace and is not offered it.

## 7. Stages

Ordered so each ships alone and is useful alone. `[AGENT-FIRST]`: ccd reaches the fleet box before the server.

| # | stage | ships alone because |
|---|---|---|
| S1 | ccd: `--title`, `--wrapper`, `named`, caps `[AGENT-FIRST]` | inert until a caller sends the flags |
| S2 | registry + sweep exemption | protects workspaces named by hand today (`ccd ws-add project-a eng-1234`) |
| S3 | `shared/slug.ts` (port) | pure; no caller yet |
| S4 | `linear.ts` + `GET /api/linear/resolve` (reads the connection file) | read-only; resolves offline until S4b |
| S4b | Settings → Linear: the connection routes and section | connecting changes nothing but titles |
| S5 | `wsAddNamed` + the route | the API works; no UI yet |
| S6 | `title` on the wire + `sessionLabel` rung | labels any titled row |
| S7 | `WorkspaceNameField` + `AddWorkspaceSheet` (`+` door) | — |
| S8 | the field in `NewSessionSheet` (chosen account) | needs S1's `--wrapper` |
| S9 | Rename (`ws-title`) `[AGENT-FIRST]` | independent |

S2 must land before S5, or the first named workspace is renamed within ~10 s of its first turn.

## 8. Rejected

- **Naming the main-checkout session** (`ccd start` with a title). Its id is `<wrapper>-<project>` and there is
  one per account and project; a ticket means work on its own branch, which only a workspace has.
- **`ws-add` on the least-loaded account, then `ccd swap` to the chosen one.** Two acts with a failure window
  between them, a session that briefly runs where the operator did not put it, and a transcript copy on every
  create — the copies `2026-10-20-workspace-disk-and-registry-truth-design.md` §1.1 is already paying to collect.
- **Auto-suffixing a taken slug** (`-2`). One ticket maps to one slug on purpose; a second workspace for the same
  ticket is answered with 409 and ccd's own reason.
- **`CCD_WS_SLUG` as the transport.** Honoured only when the positional is empty, and an environment variable
  cannot cross the agent's exec seam (`ExecReq` is `{cmd,args,timeoutMs}`).
- **The Linear call on the fleet box.** The agent has no outbound HTTP and `EXEC_COMMANDS` is closed to
  `tmux`/`ccd`; a `curl` grant is what the whitelist forbids. The server is the only place it can live.
- **Storing the title in `coord.db`.** The flat registry is ground truth and a lost `coord.db` rebuilds from it; a
  title there would not survive that.

## 9. Open questions

All three are answered (2026-10-20).

- **O1 — a chosen account that cannot take the workspace.** **Ruled as recommended:** **refuse with ccd's reason** (*lane-a is
  at its limit*), keep the sheet open, and let the operator pick another account. The alternative, quietly placing
  it elsewhere, contradicts the choice the operator just made on the same screen.
- **O2 — include Rename (S9) in this delivery?** **Yes, by the operator's own ask:** "there should also be an
  option to rename an existing workspace". It ships as the last stage.
- **O3 — the Linear token.** **Ruled: a personal API key with read access is fine, and the whole connection lives
  in Settings** (2026-10-20). §5.1 replaces the environment variable this question first proposed.

## 10. Verification

- Red-first tests per stage, each guard with a mutation measured red (the repo's mutation-table discipline):
  the hoisting mutant (S1), the doubt arm (S2), the parity pin and each refusal reason (S3), `Authorization`
  without `Bearer` and each failure arm (S4), the empty-`calls` assertion on a refused name and the blank-name
  omission (S5), the no-autofocus pin and the 409-keeps-the-sheet-open pin (S7/S8).
- `deviation-refs.test.ts` green against `origin/main` before the PR.
- UI stages: a fresh, blind `ui-verifier` against the running PWA at phone and desktop widths.
- `ccrc-pwa` has no `fleet verify` contract today; the gate is the three packages' suites, run in the
  foreground, with the known load flakes re-run in isolation.
