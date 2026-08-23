# A polish pass on the fleet: pinned vs actual, honest titles, density

**Goal:** make the fleet screen read as a dense, scannable list rather than nine
tall boxes each holding one line; give the project header the account it is
*pinned* to and the workspace line the account it is *actually on*; and stop
labelling every row with a machine-generated slug. Plus the chat header's
top-right controls, and three defects the hierarchy work shipped.

Follows [the fleet hierarchy](2026-07-28-ccrc-fleet-hierarchy-design.md), which
shipped on 2026-07-29 and is live.

## Measured, not estimated

Captured from the live PWA at `203.0.113.7:7788` on 2026-07-29, phone viewport
390×844, via a headless Chromium reading the real fleet:

```
.proj-card        367 × 118      9 cards
.proj-card-toggle 208 ×  44      (header row)
.sess-line        367 ×  44      (one session)
.proj-card-add    151 ×  44      ← 41% of the header's width
.proj-add-acct    118 ×  17      "team·alt · 99% free"
.fleet-list             1158     document 1428
```

**An earlier draft of this spec said each card cost ~200px. That was wrong** —
eyeballed off a 2× screenshot instead of measured. The real figure is 118px, so
the honest ceiling for tightening is **~15–20%, not ~50%**. Everything below is
sized against 118.

Of that 118: 44px header + 44px line = 88px of content, 24px card padding, 6px
internal gap. The content is already near the 44px thumb-target floor, which is
why the win is bounded — the fat is in the padding, the gap, and one string.

### The live fleet, as the wire actually reports it

Nine sessions, `GET /api/fleet`, 2026-07-29:

| project | name | branch | workspace | wrapper | home |
|---|---|---|---|---|---|
| custom-tools | `custom-tools-9a` | `feat/mirror-heartbeats-to-da…` | null | claude-corp | claude-corp |
| data-internal | `data-internal-7a` | `feat/surface-and-accounts-fi…` | null | claude-corp | claude-corp |
| acme-platform-ts | `frontend-ui-foundation-39` | `feat/company-enquiry` | null | claude | claude |
| intake-platform | `add-mcp-image-attachments` | `feat/board-phase-1` | null | claude-corp | claude-corp |
| rp-llm | `rp-llm-98` | `main` | null | claude2 | claude2 |
| synapsium-platform | `synapsium-platform-3a` | `main` | null | claude | claude |
| MekWarLive | `mekwarlive-e7` | `main` | null | claude2 | claude2 |
| OpenClawHetzner | `openclawhetzner-42` | `main` | null | claude | claude |
| expoAI-assistant | `expoai-assistant-44` | `main` | null | claude | claude |

Three things fall straight out of that table, and each one changes a decision
below:

1. **`workspace` is null on all nine — but two of them are worktrees.** There are
   no *ccd* workspaces; two sessions run in Claude Code's own
   `.claude/worktrees/`, which ccrc does not classify. Every card therefore
   renders as a project and its main checkout, and two of those claims are
   false. See "Titles" below.
2. **Eight of nine `name`s are session handles, and Claude Code says so** in a
   `nameSource` field ccrc currently drops. See "Titles" below.
3. **`wrapper == home` on all nine.** Pinned and actual agree everywhere right
   now, so the divergent case cannot be seen by looking — it has to be designed
   for deliberately and tested synthetically.

## Pinned on the card, actual on the line

The card header carries the project's **pinned** account; each workspace line
carries the account that workspace is **actually running on**.

This is the whole two-field model made visible, and it is the reason to show an
account in two places rather than one. ccd keeps both per session: `home` is
where the session belongs, `wrapper` is where it is running. `_auto_swap_check`
moves `wrapper` off `home` when that account's 5h score crosses
`SWAP_THRESHOLD`; `ccd prefer <id> <wrapper>` moves `home` itself. Today they
agree on all nine sessions, so the distinction is invisible — which is exactly
why it needs a home on screen before it matters.

**Pinning is still per session, so the header derives its value:**

- All of a project's sessions share one `home` → the header shows it.
- They disagree → the header shows `mixed`.

`mixed` is one word, it is rare, and it is worth seeing: divergent pins across a
single project's workspaces is a real condition a reader would want to notice.
The alternative — showing nothing — makes "divergent" and "unknown"
indistinguishable, and every card has at least one session, so "unknown" cannot
otherwise occur.

**An earlier version of this spec ruled that the header shows no account at
all**, on the grounds that a project-level binding does not exist. The first half
of that reasoning was right and the conclusion was wrong: a project-level *pin*
is derivable and useful, as long as the header never claims a single value the
sessions do not share. That is what `mixed` is for.

### When a line is away from home

The line's chip shows `wrapper`, as it does today. When `wrapper !== home`, the
chip wears a marker — the session is running somewhere other than where it
belongs, which is the single most useful thing the fleet can tell you about
routing, and it currently renders nowhere.

The full sentence ("pinned to X, running on Y since …") goes in the actions
sheet, not on the line. This follows the rule the hierarchy work already set for
the limit warning: a glyph on the line, the sentence in the sheet where there is
room to explain.

**The line's account chip stays at every width.** The hierarchy work's container
query drops `.sess-acct` when the list is narrow, which means the desktop
sidebar hides the actual account and keeps the projection — backwards. That
query is removed, not widened.

## Titles: eight of nine rows are labelled with a session handle

`SessionLine` labels a row `name ?? branch ?? workspace ?? id`, so on the live
fleet the label is `name` on all nine rows. **A session handle is not end-user
information**, and eight of nine names are exactly that.

The evidence is not a guess — Claude Code declares it. Every
`<config-dir>/sessions/<pid>.json` carries a `nameSource` field beside `name`.
Read across all four wrapper config dirs (`~/.claude`, `~/.claude-corp`,
`~/.claude-personal`, `~/.claude-glm`):

```
name                        nameSource   cwd basename
custom-tools-9a             derived      custom-tools
data-internal-7a            derived      data-internal
frontend-ui-foundation-39   derived      frontend-ui-foundation
add-mcp-image-attachments   (absent)     board-phase-1
rp-llm-98                   derived      rp-llm
synapsium-platform-3a       derived      synapsium-platform
mekwarlive-e7               derived      MekWarLive
openclawhetzner-42          derived      OpenClawHetzner
expoai-assistant-44         derived      expoAI-assistant
```

`derived` means Claude Code built the string from the working directory plus a
counter. **By construction it can never describe the work.** Meanwhile `branch`
on those same rows reads `feat/mirror-heartbeats-to-datadog`,
`feat/company-enquiry`, `feat/board-phase-1`.

`SessionHeader` already knows this. Its comment reads *"Show the clean project
name, not Claude Code's auto-derived session name (e.g. `custom-tools-91`), which
reads as noise"* — the chat header rejects `name` outright while the fleet line
prefers it. One of the two is wrong, and the table says which.

**Ruled: a name is shown only when `nameSource !== 'derived'`.**

An earlier draft of this spec proposed a regex —
`^<basename(cwd) lowercased>-[0-9a-z]{1,3}$` — which produces the same 8/1 split
on today's data. It is the wrong mechanism: it reconstructs by pattern-matching a
fact the file states outright, and it silently starts mislabelling the day Claude
Code changes its derivation scheme. The declared field is the authority.

`nameSource` is **not currently on the wire.** `livestate.ts` reads `name`,
`status`, `statusUpdatedAt` and `version` out of that file and drops the rest, so
this needs the field plumbed through `LiveState` → `FleetSession`. The absent
case (`add-mcp-image-attachments`, an older-format file) is treated as
not-derived: a name Claude Code does not claim to have generated is a name
somebody chose.

The chain becomes `chosen name ?? branch ?? workspace ?? id`. The fallback is
never worse than what it replaces: a branch is at minimum `main`, which is at
least true.

### The fleet does not recognise Claude Code's own worktrees

Two of the nine sessions are running in worktrees:

```
frontend-ui-foundation-39   .../acme-platform-ts/.claude/worktrees/frontend-ui-foundation
add-mcp-image-attachments   .../intake-platform/.claude/worktrees/board-phase-1
```

Both have `workspace: null`, because ccrc derives `workspace` from ccd's
`WORKTREES_ROOT` and these live under Claude Code's own `.claude/worktrees/`.
So the fleet renders each as if it were the project's main checkout — the
`acme-platform-ts` card claims a lone main session that is really a feature
worktree.

**Not fixed in this pass, but recorded**: the label chain above already makes
both rows read correctly (`feat/company-enquiry` and the chosen name), so the
visible symptom goes away. The underlying misclassification — and what `ws-rm`
or `ws-gc` would make of a worktree ccd did not create — belongs with the
workspace-lifecycle work, not here.

### Autogenerated titles proper

Filtering the slug out is a correction, not the feature the question was really
about. A genuinely helpful title — Conductor's *"Validate local ch access…"* — is
a summary of what the session was asked to do, and the only place that exists is
the first user message of the transcript.

**Ruled: derive it, in this pass, server-side.**

The server already reads and parses each session's JSONL transcript for
`/api/session/:id/chat`. The first `user` event's text, trimmed to a phrase,
gives the same class of title Conductor shows. It is immutable once written, so
it is cached per session uuid and read once, never on the poll path — this must
not add a file read per session per fleet snapshot.

It enters the chain **below** a deliberate name and **above** branch: a human's
chosen name wins, then what the session was asked to do, then where it is.

```
deliberate name ?? first-prompt title ?? branch ?? workspace ?? id
```

Sessions with no transcript yet (just spawned, or resumed with the file
elsewhere) fall through to `branch` exactly as today. No row ever loses a label.

## Three defects

### The header's projection clips in the desktop sidebar

`.proj-card-add` is **151px of a 208px header** — 41% — and `.proj-add-acct`
inside it renders `team·alt · 99% free`. In the desktop sidebar
(`clamp(300px, 25vw, 380px)`) it runs past the pane edge and is sliced
mid-character on every card.

The hierarchy work added a container query intended to fix this, but it drops
`.sess-acct`, the **session line's** account. The element actually overflowing is
`.proj-add-acct`, the **header's** projection. Right rule, wrong element.

### The same string renders nine times

`+ team·alt · 99% free` is identical on every card, because the projection is
global — it is where the *next* workspace would land, and that does not vary by
project. Nine copies of one fact, at 118px of vertical each, is the loudest
redundancy on the screen.

### The desktop sidebar scrolls horizontally

Measured at 1440×900 against the live fleet:

```
.shell-nav   clientWidth 344   scrollWidth 409   ← 65px of horizontal overflow
.fleet-list  clientWidth 312   scrollWidth 393   ← 81px
.proj-card   width 393         scrollWidth 391   ← the card's CONTENTS fit; the card does not
.sess-line   width 367
```

**Root cause: `.fleet-list` is `display: grid`, and a grid item's default
`min-width` is `auto` — meaning min-content.** `.proj-card` therefore refuses to
shrink below the minimum width of what it contains, which is set by
`.sess-line`'s own grid: `auto minmax(0, 1fr) auto auto auto auto`. The label
track can collapse to zero, but the five `auto` tracks (state, tally, warn,
account, actions) each contribute their max-content, so the row's floor is 367px
and the card's is 393px — in a 312px column.

The card does not overflow *its own* contents; it is simply wider than its
container and drags the pane's scroll width with it.

**Ruled: `min-width: 0` on the card, and the row gets a second line.**

Horizontal scroll in the left pane is a defect at every width, not a
small-viewport concession. `min-width: 0` on `.proj-card` removes the overflow —
measured, zero at 1200/1440/1920.

That alone leaves the row's seven cells fighting over 252–332px, and the first
attempt at resolving it was to hide the state word in a narrow container. **That
was the wrong shape of answer, twice over.**

It was wrong *empirically*: `.fleet-list` measures 252–358px in every
configuration measured, desktop and phone alike, so a 380px threshold hid the
word everywhere and the query was never not firing.

It was wrong *structurally*: `.sess-line`'s children were all auto-placed, and
**CSS Grid removes a `display: none` item from grid-item generation entirely** —
unlike `visibility: hidden`, which keeps its track. So hiding one cell compacted
every later sibling one track left. Measured at 1440: `.sess-acct` landed in the
16px warn track with its `nowrap` text painting through the `···` glyph. The
letter of "never hide the account chip" held; its purpose did not.

**The row becomes two lines:**

```
●  feat/mirror-heartbeats-to-datadog                    ···
   working · 4/5 · team·b
```

Three grid children — lamp, label button, actions — with the meta cells in a
flex row nested inside the label button. Nothing is hidden at any width, so:

- the container query is **deleted**, not inverted; the invariant that the
  account chip always renders is satisfied by structure, not by a rule
- the `display: none` compaction bug cannot recur — there is no hideable grid
  child left
- `.sess-tally` and `.sess-warn` return to conditional rendering; in a flex row a
  missing sibling shifts nothing, so the always-render workaround becomes dead
  markup
- the label gets the full row width instead of a measured 76px

**The cost is real and is not dressed up.** The row grows from 44px to roughly
52–56px, so the density figure in the table above regresses. The measured
after-number is what gets reported, not the projection.

### The FAB covers card content

`position: fixed` bottom-right, 56px, over the list. On the live fleet it sits on
top of `expoAI-assistant`'s task tally in every viewport and both themes. The list
has no bottom padding reserving space for it.

## The card header, laid out

Left to right: chevron · project name · pinned account · (attention dot) · `+`
hard right.

```
▾  custom-tools          claude-corp                        +
   ⎇ feat/mirror-heartbeats-to-datadog  working  4/5  claude-corp  ···
```

The `+` becomes **icon-only and right-aligned**. The projected account and
headroom move into its accessible name, which is where they already are:

```
aria-label="New workspace on custom-tools — team·max, 91% free"
```

On a fine pointer they also appear as a `title` tooltip. Nothing is lost for a
screen-reader user, the clipping disappears because the header is now short, and
the same fact stops being repeated nine times in a column.

**The headroom percentage is dropped from the visible UI entirely.** It is
already on the accounts strip at the top of the screen, in more detail and for
every account at once. Repeating it per project told the reader nothing the strip
had not already said better.

**Not moved to a global banner.** It is genuinely per-press information — the
projection can change between two taps as limits move — so it belongs on the
control, just not shouted from it.

**The count is dropped when it is `1`.** Every project on the live fleet reads
`1`; a badge that is constant carries no information.

## Density: tighten, keep one layout

**Ruled during design: the uniform shape stays.** A project holding one session
still renders exactly like one holding five — header plus lines. Collapsing the
single-session case to one row was considered and rejected: it is a second layout
to learn, and the hierarchy spec ruled against exactly that.

So the savings come from padding, redundancy and alignment, not from structure:

| change | saves | why it is safe |
|---|---|---|
| card padding `--sp-3` → `--sp-2` | 8px | 12→8px; the border already separates cards |
| header/body gap `--sp-1` → `0` | 4px | the 44px rows already have internal breathing room |
| list gap `--sp-3` → `--sp-2` | 4px/card | cards are bordered; 12px between them is generous |
| drop the count when it is `1` | 0px | pure noise removal |
| projection out of the header | 0px | fixes the clip |

**118px → ~102px per card, 1158px → ~950px for nine.** An 18% cut, stated
honestly rather than dressed up. The visual win is larger than the number: the
header stops being 41% `+` button, and the columns line up.

The 44px minimums on `.sess-line` and `.proj-card-toggle` are **not** reduced.
They are thumb targets, and this is a phone-first app.

## The row's text sits 11px too high

Measured on the live page, one `.sess-line` (44px tall, `align-items: center`):

```
.sess-line     mid 257.1
.sess-lamp     mid 257.1   ✓ centred
.sess-actions  mid 257.1   ✓ centred
.sess-label    mid 246.3   ← 10.8px high, top flush with the row
.sess-state    mid 247.1   ← 10.0px high
```

The dot is not low — **the text is high.** `.sess-open` is
`display: flex; align-items: baseline` with `min-height: 44px`. Baseline
alignment lines the label and state up with each other correctly, but it does not
centre the group inside a box that `min-height` has made taller than its content,
so the text sits flush against the top of the 44px row while the dot and the `···`
centre themselves. That is the visible off-centre wobble on every row.

Fix by centring the group rather than removing the 44px target — the button is
what the reader taps, so it keeps its size. Where label (16px) and state (12px)
no longer share a baseline after centring, match their `line-height` so the two
still read as one line.

### Column alignment

`.sess-line`'s grid is `auto minmax(0,1fr) auto auto auto auto`, so the tally and
`⚠` sit wherever the label ends — different on every row, which is why `4/5` and
`65/73` float mid-row in the screenshots. Give the trailing cells fixed tracks so
state, tally and `···` align down the whole list.

## The chat header's top-right

Today: back chevron · title · meta chips · `>_` · `⋯` · `esc`.

### The title is the project, and that breaks the moment workspaces return

`SessionHeader` sets `title = session.project`. With two workspaces of one
project open, both headers read `custom-tools` — identical, with nothing to tell
them apart. The fleet line below already labels them distinctly; the chat header
throws that away.

**Ruled: breadcrumb.** `project › <the line's label>`, using the same label rule
as `SessionLine` so the header and the row a reader tapped agree. On a project's
main checkout there is no second segment and it renders as today.

### `esc` is a touch control, and desktop has no substitute

The `esc` keycap interrupts a busy session. **The PWA binds no keyboard handler
for `Escape` anywhere** — verified by grep; the only match is the byte the
terminal drawer sends. So removing the keycap on desktop, as asked, would remove
the ability to interrupt entirely rather than move it.

**Ruled: same predicate as the composer's Enter rule.**

| context | interrupt |
|---|---|
| `(pointer: fine)` | the physical `Escape` key; keycap hidden |
| `(pointer: coarse)` | the `esc` keycap, as today |

The keycap exists because phone keyboards have no Escape key. Where one exists,
the key is the better control and the cap is clutter — but the binding has to be
added in the same change that hides the cap, or the capability is simply lost.
The key fires only while the session is busy, matching the cap's `disabled`
state, and only when focus is not in a text field.

### The PR control

The freed top-right slot takes the PR control, Conductor-style.

**Scoped to read-only in this pass.** Plan B of the hierarchy work already
specifies PR *state* — `gh pr view` through the agent, a `pr: PrState | null`
field, a badge. That state renders in the chat header's top-right and on the
fleet line's reserved right side. A branch with no PR renders nothing.

**`gh pr create` is deliberately not in this pass.** Opening a pull request is an
outward-facing, hard-to-retract action, and a one-tap button for it on a phone
deserves its own design — confirmation, target branch, title and body all have to
come from somewhere. Reserving the slot now and landing the action later costs
nothing; shipping the button first would not.

This requires a `gh` entry in `agent/src/whitelist.ts`. **Note for
implementation:** `isExecAllowed` checks only `args[0]`, so `gh: ['pr']` would
permit `gh pr create` and `gh pr merge` as readily as `gh pr view`. A read-only
phase needs the whitelist to discriminate further than it currently can, or the
call has to be shaped so `args[0]` is not `pr`.

## The disabled `gpt` lane

`ccd` has a kill-switch at `~/.cc-sessions/gpt-disabled`; when present, `ccd ls`
reports the lane `DISABLED`. It has been on since 2026-07-28. **The PWA does not
know.** `/api/accounts` enumerates `~/.cc-limits/*.json`, `gpt.json` exists, so
the strip renders a fourth account as if it were available.

**Ruled: hide it while disabled.**

This is not a CSS change — the server has to say so. `readLimits` gains a check
for the kill-switch file through the same `FleetIO` it already uses (so it works
in both local and remote mode), and the wire gains `disabled: boolean` on the
account.

**Two consumers, not one.** `AccountsStrip` is the obvious one. The other is
`SwapSheet`: `pickableWrappers` builds its list from `KNOWN_WRAPPERS`, which
includes `gpt` — so the swap picker currently offers a target that cannot work.
Hiding it in the strip while leaving it in the picker would fix the display and
keep the broken action. Both honour the flag.

A flag rather than omitting the account from the response: the server knows the
difference between "no telemetry for this account" and "this lane is switched
off", and collapsing them would make the two indistinguishable to any future
reader.

## Enter sends, with a real keyboard

`Composer.tsx:134` today: Enter inserts a newline, `Cmd`/`Ctrl`+Enter sends. The
comment states the reason — "Touch keyboards: Enter is newline (touch-first)".

**Ruled: Enter sends where a physical keyboard exists; Enter stays newline on
touch.**

| context | Enter | newline |
|---|---|---|
| `(pointer: fine)` | **sends** | `Alt` / `Cmd` / `Ctrl` / `Shift` + Enter |
| `(pointer: coarse)` | newline | Enter |

Detected with `useMediaQuery('(pointer: fine)')`, the hook the shell already uses
for its desktop layout — and now the same predicate that governs the `esc`
keycap. The send button is always present, so touch loses nothing; and because
phone keyboards carry no `Alt` or `Cmd`, a blanket flip would have left no way to
type a newline on the device this app is built for.

`Shift`+Enter is accepted as a newline in **both** modes: it is the near-universal
convention, it exists on every keyboard including on-screen ones, and honouring it
where Enter already means newline costs nothing.

## Error handling

| case | behaviour |
|---|---|
| `/api/accounts` omits `disabled` (older server) | treated as `false` — the account shows, exactly as today. The PWA must not require a server upgrade to render. |
| the kill-switch file is unreadable | treated as **not** disabled. An account wrongly hidden is worse than one wrongly shown: hidden looks like the account does not exist. |
| every account is disabled | the strip renders nothing rather than an empty frame, as it already does for zero accounts |
| `projected` is null | the `+` renders with the plain "New workspace on X" name, as today — it never waits on the accounts poll |
| transcript missing or unreadable | no first-prompt title; the label falls through to `branch`. Never an error, never a blank row. |
| first user message is a slash command or empty | not a title — fall through to `branch`. A row labelled `/compact` is worse than one labelled `main`. |
| a session has no `home` (legacy row) | the card cannot derive a pin from it; it is excluded from the agreement test rather than counted as a disagreement |

## Testing

- **The clip**: assert `.proj-add-acct` is absent from the header entirely — it is
  no longer rendered there, so this is a structural assertion, not a CSS one.
- **The line keeps its account at every width.** Assert the chip renders, and
  that `fleet.css` contains no `@container` rule at all — the two-line row means
  nothing needs hiding, so the guarantee is structural. A test asserting only
  that `.sess-acct` is absent from a query would pass against a reintroduced one.
- **Grid children carry explicit `grid-column`.** A `display: none` sibling
  compacts every auto-placed cell after it, and no jsdom test can see the
  result. The test asserts each child's pin **in DOM order**, so a swapped
  assignment fails as well as a missing one.
- **No horizontal scroll in the left pane, at any width.** Measured, not tested —
  jsdom does no layout. Load the live page at 1200, 1440 and 1920 wide and assert
  `scrollWidth === clientWidth` on `.shell-nav`, `.fleet`, and `.fleet-list` at
  each. The baseline to beat is 65px of overflow on `.shell-nav` at 1440.
- **Pinned vs actual**: a project whose sessions share a `home` shows it; one
  whose sessions disagree shows `mixed`; a line whose `wrapper !== home` wears
  the away marker and one whose accounts agree does not. All three need
  synthetic fixtures — the live fleet has `wrapper == home` on every row, so
  none of this can be observed from real data.
- **The label rule**, against the nine real rows in the table above as fixtures:
  the eight `nameSource: "derived"` names are rejected, `add-mcp-image-attachments`
  (field absent) is kept, and no row ends up unlabelled. Assert the absent case
  explicitly — an implementation testing `nameSource === 'chosen'` rather than
  `!== 'derived'` passes eight of nine and drops the one name that matters.
- **`nameSource` reaches the wire.** `livestate.ts` currently drops it; a test
  that only exercises the PWA's label function would pass against a server that
  never sends the field, leaving every row on `branch`. Assert it end-to-end
  from the session file through `FleetSession`.
- **First-prompt titles**: derived, trimmed, cached per uuid, and **not read on
  the poll path** — assert the transcript is opened once across repeated fleet
  snapshots, because a per-session file read per poll is the failure mode this
  design is shaped to avoid.
- **Row alignment**: cannot be asserted in jsdom, which does no layout. Verified
  by re-measuring the live page and recording `.sess-label`'s centre against
  `.sess-line`'s — they must agree within 1px, against the 10.8px gap measured
  above. The report states this was measured, not tested.
- **The `+`'s accessible name** still carries account and headroom, and still
  falls back to the plain name when `projected` is null. Both already have tests
  from the hierarchy work; they must keep passing unchanged.
- **The count** renders for 2+ and is absent at 1. Verify by mutation.
- **FAB overlap**: assert the list reserves bottom space. A jsdom test cannot see
  overlap, so this is verified by measuring the live page, and the report must say
  so rather than claim a test covers it.
- **`disabled` on the wire**: `readLimits` marks the account when the kill-switch
  file is present and does not when it is absent or unreadable; `AccountsStrip`
  hides a disabled account; `pickableWrappers` excludes it. The last one is the
  bug a display-only fix would have left behind, so it gets its own test.
- **Composer keys**, both modes, driven by stubbing the media query: fine pointer
  — Enter sends, `Alt`/`Cmd`/`Ctrl`/`Shift`+Enter inserts; coarse pointer — Enter
  inserts, and the send button still sends. Verify by mutation that dropping the
  pointer check turns the coarse-pointer test red.
- **`esc`**, both modes: coarse renders the keycap and it interrupts; fine hides
  it **and** a physical `Escape` interrupts. The second half is the one that
  matters — a test that only asserts the cap is hidden would pass on a change
  that silently removes the capability.
- **The chat breadcrumb**: two sessions of one project produce two distinct
  headers.
- **Non-regression**: pwa 330, server 400, agent 86, three clean typechecks, and
  the contrast gate at ALL 90 PASS. Any new colour pair joins
  `design/contrast-check.mjs`.
- **Measured after, not just asserted**: re-capture the live page and record the
  new per-card height and list height against the 118 / 1158 baseline above. A
  density change that cannot be measured did not happen.

## Out of scope

- **`gh pr create` and any PR write action.** The slot is reserved; the action
  gets its own design.
- **A project-level pin in ccd.** The header *derives* a pin from its sessions.
  Giving ccd a real per-project default that new workspaces inherit is a
  defensible follow-up, and would make `mixed` rarer — but it is a ccd change
  with its own spec, not a fleet-screen change.
- **Collapsing the single-session card**, and any second layout. Ruled against
  twice now.
- **A preferences surface.** The composer and `esc` rules are derived from the
  pointer type, not chosen by the user.
- **Redesigning the accounts strip.** Only the disabled-lane behaviour changes.
- **The task progress bar.** The hierarchy spec's diagram drew one and its prose
  did not; that contradiction is still open and is not resolved here. The line
  keeps its `4/5` tally.
