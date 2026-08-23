# The card is the project; the line is the workspace

**Goal:** invert the fleet screen's hierarchy so a card represents a *project* and
each session inside it is a compact line — making projects scannable and giving
every project a visible identity, which it currently lacks whenever it holds only
one session. Fold state persists, and each line carries the state of its
branch's pull request.

Follows [workspaces Phase 1](2026-07-28-ccrc-workspaces-design.md), which shipped
grouping but kept the session as the unit of visual weight.

## What exists, and why it reads wrong

Phase 1 grouped by project but left `SessionCard` as the big element, with the
project reduced to a thin header that appears **only** when a project holds two
or more sessions (`ProjectGroup.tsx`, `grouped: members.length > 1`).

On the live fleet that means the project header never renders at all: nine
sessions across nine distinct projects, every one of them ungrouped. So the
strongest visual element on the screen is a session, and the thing the reader
actually navigates by — the project — has no container.

The inversion also fixes a subtler wart. A standalone card titles itself on
`session.project` while a grouped card titles on the workspace, so the same
component means two different things depending on a sibling count. Making the
project the container removes the ambiguity: a card is always a project, a line
is always a session.

## Decisions

Ruled during design; recorded so the plan does not relitigate them.

1. **Uniform shape at every count.** A project holding one session renders
   exactly like a project holding five: a card with a header and one line
   beneath. No special case, no second layout to learn.
2. **Per-session actions live behind a `···` button on each line**, not behind a
   long-press. Discoverability beats density here: a hidden gesture on a
   destructive action ("Remove workspace") is the wrong trade on a phone.
3. **A folded card still shows its urgency.** Inherited unchanged from Phase 1 —
   this screen's job is answering *"what needs me?"*, and a fold must never be
   able to hide a pending dialog.

## Two constraints the design must not break

**`FleetScreen` is also the desktop sidebar.** `app.tsx:46` mounts it as
`<FleetScreen selectedId={sessionId} showAccounts={!desktop} />` — persistent on
desktop as the master pane of a master–detail layout. A line must therefore
degrade into a narrow column, not merely fit a phone. Where space is short the
account chip is the first thing to drop; the status dot, label and `···` are not
negotiable.

**A view transition pairs the tapped title with the chat header.**
`SessionCard.tsx:124` stamps `viewTransitionName = 'session-title'` on the title
button at tap time, pairing with `chat.css:61`. The line's label button must
inherit that stamp, or the card→chat shared-element animation silently breaks —
silently, because nothing tests it.

## Components

| file | role |
|---|---|
| `fleet/ProjectCard.tsx` (new) | Replaces `ProjectGroup.tsx`. Always a card. Header + a body of lines. |
| `fleet/SessionLine.tsx` (new) | One session as a compact row. Replaces `SessionCard` in the fleet list. |
| `fleet/SessionActionsSheet.tsx` (new) | Restart · Swap account · Remove workspace. Built on the existing `components/Sheet.tsx`. |
| `fleet/foldState.ts` (new) | Reads and writes the collapsed-project set in `localStorage`. Pure and injectable, so tests never touch real storage. |
| `fleet/SessionCard.tsx` | Retired from the fleet list. |
| `fleet/ProjectGroup.tsx` | Deleted; `ProjectCard` supersedes it. |

Server-side, for PR state:

| file | role |
|---|---|
| `server/src/prstate.ts` (new) | Runs one `gh pr list --head <branch>` per distinct (repo, branch) pair, caches by that key, and maps a result to the badge state. Pure mapping separated from the I/O so the state table is testable without `gh`. |
| `shared/api.ts` | `FleetSession` gains `pr: PrState \| null` — `null` meaning "no PR, or we do not know", which the readout deliberately renders identically. |

`gh` invocation goes through the agent's whitelisted exec surface like every other
command, which means **`EXEC_WHITELIST` needs a `gh` entry** (`agent/src/whitelist.ts`).
It currently permits `tmux` and `ccd` only. Phase 1 shipped with `ws-add`/`ws-rm`
missing from that list and every suite stayed green while the feature was inert
in production — so this entry, and a test pinning it in both directions, is part
of the work rather than a deployment afterthought.

### Card anatomy

```
┌────────────────────────────────┐
│ OpenClawHetzner   ▾  2    [+]  │
│                claude · 91% free│
│                                │
│   main          idle  claude ···│
│   fix-c-u     ● busy  corp   ···│
│                ▓▓▓▓▓░░░ 4/7     │
└────────────────────────────────┘
```

- **Header:** project name, fold chevron, live session count, and the `+` with
  its projected account and headroom (`+ claude · 91% free`), exactly as Phase 1
  built it. The projection stays server-computed — the PWA never recomputes
  `_ws_least_loaded`, because a third copy of that rule would drift from both
  existing ones.
- **Aggregate state:** the card wears `attention` and `busy` from `FleetGroup`,
  which `groupFleet` already computes. No new logic.
- **Folded:** the header keeps the count and the attention dot; only the lines
  hide.

### Line anatomy

Label · status dot · account · task tally · `···`

- **Label** is `name ?? branch ?? workspace ?? id`. Phase 1 made this conditional
  on an `inGroup` prop; that prop **disappears**, because a line is now always
  inside a project card. Deleting it is a simplification the restructure buys
  back, not a behaviour change.
- **Tap** opens the session and stamps `session-title`.
- **Dead** lines read `exited`; recovery is via `···`, not a long-press.
- **Attention** is the amber dot plus the word `waiting` — see below.

### `grouped` is removed from `FleetGroup`

`grouped: members.length > 1` existed solely to choose between the bare and
headered render paths. With a uniform card there is one path, so the flag reads
nowhere. Remove it from the interface and from `groupFleet`, rather than leaving
a field nothing consumes — a dead flag is a trap for the next reader, and its
tests would keep passing while asserting nothing anyone depends on.

## What is cut rather than relocated

**The attention sentence.** `SessionCard` renders *"Claude is asking you
something — tap to answer"* as a full line of copy. On a compact row that becomes
the amber dot and the word `waiting`. The sentence earned its space on a card
that was already large; it does not on a row, and the dot plus word carry the
same information at a glance.

**The limit warning** (*"5h limit near — will move to another account"*) has no
room on a line. The line shows `⚠`; the full sentence moves into the actions
sheet, where there is room to say what it means and what will happen.

## Fold state persists

Fold state is `useState` today, so navigating into a session and back re-expands
everything. It moves to `localStorage` under a single key holding the collapsed
project names; absent means expanded, so a first run and a cleared store both
open. `lib/offline.ts` is the precedent for persisted PWA state.

**A collapsed project does not auto-expand when a session inside it needs you.**
The header already carries the attention dot — that is Phase 1's rule, and it is
sufficient. Auto-expanding would override an explicit fold the reader chose, and
on a fleet where several projects can want attention at once it would undo the
folding faster than it could be done.

Persistence is per-browser, not per-account: two devices fold independently. That
is the right default for a layout preference and needs no sync.

## PR state on lines

Each line shows the state of the PR for its branch. Read-only — raising a PR,
merging and archiving stay in workspaces Phase 2/3. The line's right-hand side
was left free for exactly this.

### Query per branch, not per project

The [workspaces spec](2026-07-28-ccrc-workspaces-design.md) proposed one
`gh pr list --state all --limit 100` per project, on the reasoning that it
"scales with projects, not workspaces". **Measured on this fleet, that design
does not work:**

| project | per-project, `--limit 100` | per-branch, `--head` |
|---|---|---|
| MekWarLive | **11214ms → HTTP 504** | **918ms** |
| custom-tools | 4638ms (100 PRs) | 515ms |
| synapsium-platform | 1969ms (51 PRs) | 492ms |
| intake-platform | 1213ms (13 PRs) | 509ms |
| OpenClawHetzner | 505ms (0 PRs) | — |

`statusCheckRollup` resolves check runs for every PR returned, so cost scales
with the repo's PR history rather than with anything we care about. MekWarLive
times out outright.

**So: one `gh pr list --head <branch> --state all --limit 5` per distinct
(repo, branch) pair.** Every session has exactly one branch, and several
sessions on one project may share none — so the call count is bounded by
sessions, not by PR history, and each is sub-second. Ten sessions on a 30s poll
is ~20 calls/minute against a 5000/hour budget.

Fields: `number,headRefName,headRefOid,state,mergedAt,url,mergeable,mergeStateStatus,statusCheckRollup`.
`headRefOid` is not used by this spec but is what the Phase 3 archive test
compares against, so fetching it now avoids a second shape later.

### Readout

| state | line shows | derived from |
|---|---|---|
| no PR for this branch | — | empty result |
| merged | `#41 merged` | `state === 'MERGED'` |
| closed unmerged | `#41 closed` | `state === 'CLOSED'` |
| open, checks failing | `#41 ✗ 2` | any rollup entry failing |
| open, branch drifted | `#41 ⚠` | `mergeStateStatus === 'DIRTY'` or `mergeable === 'CONFLICTING'` |
| open, checks running | `#41 ◐` | any rollup entry pending |
| open, clear to merge | `#41 ✓` | nothing failing, nothing pending, `mergeStateStatus === 'CLEAN'` |
| open, otherwise | `#41` | e.g. `BLOCKED` — checks fine, GitHub still won't take it |
| lookup failed | — | never a badge; see below |

Evaluated in that order: terminal states first, then problems, then readiness.

### Reading the rollup, from the real shape

`statusCheckRollup` is a **union**, and both members appear in one PR. Measured
on `custom-tools#593`: one `CheckRun` (`conclusion: null`, `status: IN_PROGRESS`)
and one `StatusContext` (`state: 'SUCCESS'`, no `status`). So:

- `CheckRun` → `conclusion` when set; when null, `status` of `QUEUED`/`IN_PROGRESS`
  means **pending**.
- `StatusContext` → `state` (`SUCCESS` / `PENDING` / `FAILURE` / `ERROR`).
- **`SKIPPED` and `NEUTRAL` are not failures.** MekWarLive's `#3193` carries
  33 `SUCCESS` and **5 `SKIPPED`** of 38. A naive `every(c => c.conclusion ===
  'SUCCESS')` would call that PR not-green, and skipped jobs are routine in real
  CI — so this is the default case, not an edge one.

**`mergeable` alone is insufficient.** `#593` is `MERGEABLE` yet `BLOCKED` —
GitHub would refuse it, presumably pending review. A line reading `✓` there would
be exactly the confident-and-wrong display this feature exists to avoid, which is
why readiness requires `mergeStateStatus === 'CLEAN'` and everything else open
falls through to a bare `#41`.

**`mergeable` is only meaningful for an OPEN PR.** Measured: MekWarLive's merged
`#3193` returns `mergeable: UNKNOWN, mergeStateStatus: UNKNOWN`. Applying the
readiness rule blindly would render a merged PR as conflicted. Gate the
`✓`/`⚠` logic on `state === 'OPEN'` first.

**`✓` requires both signals.** A green rollup means CI passed; it says nothing
about conflicts or required reviews. A line reading ready beside a PR GitHub
would refuse is the confident-and-wrong display this whole feature exists to
avoid.

### Failure is silence, never invention

A failed, timed-out, unauthenticated or rate-limited lookup yields **no badge** —
never a guess, never a stale value presented as current. A per-branch failure is
logged once per backoff window rather than once per poll, and it never blocks the
fleet stream: the line renders exactly as it would for a branch with no PR.

This matters because the fleet has three orgs (`example-corp`, `example-org`,
`Synapsium-Labs`) behind one `gh` token. Access to all three was verified, but a
token change or an org policy could silently remove one, and the failure mode
must be a quiet absence rather than nine rows of wrong.

## Interactions and error handling

| action | behaviour |
|---|---|
| tap a line | opens the session; stamps `session-title` for the transition |
| tap `···` | opens `SessionActionsSheet` for that session |
| Restart (sheet) | `api.ensure(id)`; failure surfaces via `apiErrorText` |
| Swap account (sheet) | hands off to the existing `SwapSheet` — not reimplemented |
| Remove workspace (sheet) | `api.workspaceRemove(id)`; shown **only** when `session.workspace !== null`; failure surfaces ccd's own refusal via `apiErrorText` |
| tap `+` | `api.workspaceAdd(project)`; disabled while that project's add is in flight |
| tap the header | folds/unfolds |

Every failure path uses `apiErrorText(err)`, never `err.message`. The `runCcd`
routes fail as `502 { ok, stderr }` with no `error` key, so `err.message` yields
the generic `request failed (502)` and ccd's actual refusal never reaches the
reader. This is not hypothetical — it shipped twice in Phase 1 and was caught
only by a test that stubbed `fetch` with the real server shape.

**Remove workspace has no confirm dialog,** unchanged from Phase 1: `ccd ws-rm`
refuses on a dirty tree, an unmerged branch, or a main checkout, and explains
why. The guard lives where the facts are. That makes surfacing the refusal text
load-bearing rather than cosmetic.

## Testing

- **`groupFleet`**: the existing ordering and attention tests survive; the
  `grouped` assertions are removed with the field.
- **`ProjectCard`**: renders a card at one session and at several; header carries
  name, count and `+`; folding hides lines but not the count or the attention
  dot; `+` disabled while adding.
- **`SessionLine`**: label falls back through `name → branch → workspace → id`,
  with the `id` tail covered (Phase 1 shipped that tail untested and a mutation
  proved nothing caught it); dead lines read `exited`; `···` opens the sheet.
- **The view transition**: assert the label button receives
  `viewTransitionName === 'session-title'` on tap. Phase 1 relied on this and
  never tested it; the restructure moves the stamp to a new element, which is
  exactly when an untested invariant breaks.
- **`SessionActionsSheet`**: Remove workspace absent when `workspace === null`;
  each action calls its api method; each failure surfaces ccd's text — verified
  through a stubbed `fetch` returning `502 { stderr }`, not a mocked rejection.
- **Desktop sidebar**: a line remains usable at sidebar width — label, dot and
  `···` all present and hit-testable.
- **Fold persistence**: a collapsed project stays collapsed across a remount;
  an empty or corrupt store yields "everything expanded" rather than a throw;
  and a collapsed project whose session raises a dialog stays collapsed while
  its header shows the attention dot.
- **PR state mapping**, as a pure function over the `gh` JSON, from fixtures
  captured from the real API — every row of the readout table, plus:
  a merged PR with `mergeable: UNKNOWN` must render `merged`, never `⚠`
  (MekWarLive's `#3193` is the real case); a green rollup with
  `mergeable: CONFLICTING` must render `⚠`, not `✓`; and an empty result, a
  non-zero exit, a 504 and unparseable output must all render no badge.
  Verify by mutation that dropping the `state === 'OPEN'` gate turns the suite
  red — that gate is the whole reason a merged PR reads correctly.
- **`gh` whitelist**: pinned in both directions — `pr` permitted, an
  unlisted subcommand still refused.
- **Non-regression**: server 335, agent 86, pwa 313 (before the reshape), three
  clean typechecks, and the contrast gate at ALL 82 PASS. Any new
  foreground/background pair must be added to `design/contrast-check.mjs`'s
  `pairs()` list rather than left invisible to the gate.

**Five** existing test files reference the retiring card or the `grouped` flag
and will need reshaping — measured, not estimated:

| file | tests | what it holds |
|---|---|---|
| `fleet-screen` | 16 | renders the list through `ProjectGroup` |
| `session-card` | 12 | the retiring component |
| `project-group` | 12 | the deleted component; replaced by a `ProjectCard` suite |
| `polish` | 11 | card-level visual assertions |
| `groupFleet` | 9 | two assertions on `grouped`, removed with the field |

`chat`, `contrast` and `stores` do **not** reference either — an earlier draft of
this spec claimed seven files and was wrong. Two source files mention the card
only in comments (`lib/useNow.ts`, `session/chat.css`); `chat.css:60` is the one
that matters, because it names the `session-title` transition the line must
inherit.

## Out of scope

- **Raising a PR, merging, archiving.** Workspaces Phase 2/3. This spec reads PR
  state; it never writes. No `gh pr create`, no `gh pr merge`, no draft prompt
  injected into a session, no auto-archive on merge.
- **Reordering or filtering projects.** `sortFleet`'s urgency order stands
  unchanged, and group order still derives from it.
- **Touching `SessionCard.tsx` beyond retiring it from the list.** If nothing
  else consumes it after the reshape, deleting it belongs to this work; if
  something does, it stays where it is.
