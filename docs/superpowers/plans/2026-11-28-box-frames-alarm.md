# Box frames alarm: the lane says, in one word, when a new build draws the input box in another form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Step 1 of desktop-polish wave 198.** This is the plan revision the brief asks for before any code outside the new shape
> file and its cases. Its design is section 7 of `docs/superpowers/plans/2026-11-26-box-frames-recipe.md`, agreed in
> substance by the capture owner. Sections 3 to 5 go to the capture owner as packets, each before the code it covers.

**Goal:** when a new Claude Code build draws the input box in another FORM than the build before it, the test box status
read (`GET /api/testbox`) says so in one word, `new-form`, before a person meets it in the send. It names the frames that
differ by id. It also says when the newest build's frames were refused or over the cap, because a build that draws
something the reducer refuses is itself news. No frame text and no shape token leaves the server.

**Why (from the brief).** The console's send presses Enter only on a box it can prove holds its text. Its proofs were built
from one build's recorded panes. A later build drew a tall draft in another form, and long pastes sat unsent. The frames
recipe (#3487, with #3613) now records how each build draws the box. This wave adds the reason it was built: the alarm.

**Architecture:** a pure SHAPE rule in a new L0 file (`shared/framesShape.ts`), from a frame's reduced text to a token list
and its hash, with its own computed version. A pure standing decider and its one reader in a second new L0 file
(`shared/framesStanding.ts`), in `deliveryLane.ts`'s pattern. The lane (L4) asks the decider whether to shape a frame and
stores the shape with the row. The store (L3) gains one additive column and one text-free read. The status read (L4) serves
the decider's answer beside `delivery`. Decide in L1, act in L4.

**Tech stack:** TypeScript, vitest, `node:sqlite`; `shared/`, `server/`, one `agent/` case.

**Claims are labelled** **read** (from the code at `origin/main` ee21bf76ce), **inferred**, or **to measure** (by a named
case). Nothing in this plan ran Claude Code, and nothing will. No real test box is reached.

## 1. In short

- **The shape** is a list of one token per row of the reduced frame, plus one cursor token. A token keeps the row's CLASS
  (rule, chip, glyph, our text, blank, other) and the structure the send reads (a rule label's and a chip's skeleton, the
  dim attribute, indent and border characters). It never keeps the build's words in any other row. Runs of other rows and
  blank rows above the box collapse, so a longer banner or scrollback is not a new form.
- **The standing.** Two builds draw the same form when every frame id both hold as drawn, cleared and shaped at the same
  shape version has the same shape hash. The status read's `frames` carries one of four kinds, as `delivery` does:
  `standing`, `no-trusted-build`, `unreadable`, and `unknown` (an older server: the key absent). A standing carries the
  newest trusted build, the build it was compared against (or null), the form word (`same-form`, `new-form`, `first-form`,
  `incomplete`), the differing frame ids, a second word for refusals (`none`, `refused`, `over-cap`,
  `refused-and-over-cap`) and the refused and over-cap frame ids.
- **Storage.** One additive column, `shape`, on `claude_build_frames`, by its own migration: the shape version, the hash
  and the row's `at`, never the tokens (the capture owner's change A, call 1963). It is bound to the row's `at`, so a row
  an older server re-records reads as unshaped, never as the old shape. The status read's store read is text-free and
  bounded by builds (change B).
- **Carried from the reviews of #3487.** A warn line when the box's frames recipe version and the server's differ (today
  the lane returns silently). A case that reads the `settings.json` the runner writes.
- **Not in this wave.** No console surface. No change to the reducer, the send, the delivery recipe (its version still
  prints `da16fe2f55551e0b`) or the trust recipe. No new route.

## 2. The shape (`shared/framesShape.ts`, L0)

`frameShape(text, cursor, ours)` answers `{tokens: readonly string[], hash: string}`. `text` is a REDUCED frame (what the
store keeps, already cleared by the receiver's check). `cursor` is the frame's `[x, y]` or null. `ours` is the part's own
fixed texts, `framesCapture.ts#framesOurs(case, pane)`. It imports only `shared/` siblings: `framesReduce.ts` (the rule
row test, the our-row test, the decoration list), `framesResult.ts` (the SGR stripper) and `framesCapture.ts` (the hash
function, see 2.5).

### 2.1 Rows and classes

The rows are `text.split('\n')`, less one trailing empty line, as `framesResult.ts#frameSize` counts them. Each row is
read with SGR removed (`stripFrameSgr`), except for the dim attribute (2.3). The first class that matches wins:

| Class | A row is in it when | Token |
|---|---|---|
| `R` rule | `framesReduce.ts#isRuleRow` (a run of 10 or more `─`) | `R:` then the label skeleton |
| `C` chip | its text holds Claude Code's paste label, `[Pasted text #` and a digit | `C`, then `g` if it starts with the glyph, then `~` if dim, then `:` and the chip skeleton |
| `G` glyph | after its leading spaces and `│`, it starts with the prompt glyph `❯` or the older `>` | `G`, then `~` if dim |
| `T` our text | `framesReduce.ts#rowIsOurs`, the reducer's own rule 2 test, over `ours` | `T`, then `~` if dim |
| `B` blank | nothing is left once spaces and the border characters `│ ╭ ╮ ╰ ╯` are removed | `B`, or `B|` when it holds a border character |
| `X` other | anything else | `X`, its indent, `|`, its edge characters |

- **The label skeleton** of a rule row: the row with every `─` and the four corners `╭ ╮ ╰ ╯` removed, trimmed, each run
  of whitespace as one space, and each run of digits as `9`. So `──── ↑ 156 more ────` is `R:↑ 9 more`, and a plain rule
  is `R:`.
- **The chip skeleton**: the label from `[Pasted text #` to the next `]` (or the row's end), each digit run as `9`. So
  `[Pasted text #1 +179 lines]` is `[Pasted text #9 +9 lines]`. The paste label's pattern is the send's
  (`server/src/inject/send.ts`'s `PASTE_CHIP`, which an L0 file cannot import). A text case holds the two equal, the
  `FRAMES_NUDGE_TEXT` way: a recorded "legitimately different" copy across the ring boundary.
- **An X row's indent** is its count of leading U+0020 spaces. **Its edge characters** are the characters of the
  decoration spans at its two ends (`framesReduce.ts#FRAMES_DECORATION`, the reducer's closed list), spaces removed, in
  order. So `  ⎿  Interrupted by user` is `X2|⎿`, `│ some text │` is `X0|││`, and the status row `  ccrc capture` is
  `X2|`. No word of an X row is kept.
- **Why C before G before T.** In the old form the first row of a tall draft is a glyph row holding our text; in the new
  form it is our text with no glyph. Taking G before T is what makes that difference a different token. A chip row may
  start with the glyph; its `g` mark keeps that.

### 2.2 The box's top rule, and the collapse

- **The box's top rule** is the rule row above the lowest rule row: the second-last `R` row, or the only one. (Section 7 of
  the recipe plan anchors on "the last R-over-G pair". The new form has no glyph row under its top rule, so that anchor does
  not exist in exactly the frames the alarm is for. The reducer already requires a lowest rule with the status row under
  it, so every cleared frame has at least one `R` row. **For the coordinator's ruling: this replaces the plan's anchor.**)
- **Above the top rule**, each maximal run of `X` rows (whatever their indent and edges) becomes one `X+`, and each
  maximal run of `B` rows becomes one `B+`. `R`, `C`, `G` and `T` rows above it keep one token each, so an earlier turn's
  rows of our text are counted exactly.
- **From the top rule down**, every row keeps its own token: the count of `T` rows in the box is the row cap the build
  drew.

### 2.3 Dim

A `C`, `G` or `T` row is dim (`~`) when one or more of its characters that are neither a space nor a decoration character
is drawn while dim is on. Dim is read by walking the row's SGR sequences in order: parameter `2` turns it on; `22`, `0`
and an empty sequence (`ESC [ m`) turn it off; the extended colour forms `38`, `48` and `58` take their arguments
(`5;n` or `2;r;g;b`, and the colon forms) with them, so a colour index `2` is never read as dim. The send's readers undim,
so dim is structure (section 7). This is not the send's `undim`, which removes dim runs from a line it reads as a draft;
the shape asks a different question of one row, so it has its own walker, named in the departures (section 8).

### 2.4 The cursor

One last token: `@<dy>,<x>`, where `dy` is the cursor's row less the top rule's row (it may be negative) and `x` its
column, or `@-` when the frame carries no cursor.

### 2.5 The hash and the shape version

- **The hash**: 16 lowercase hex, FNV-1a twice over the JSON of the token list, the recipes' own rule
  (`framesCapture.ts#fnv1a`, exported so there is one copy for the frames files; `FRAMES_RECIPE_VERSION` must print the
  same before and after, pinned).
- **`FRAME_SHAPE_VERSION`**: 16 hex, computed the way the recipe versions are: the hash of the JSON of `frameShape`'s
  answers on a fixed probe table (section 2.6's three examples, a frame with every class, the dim cases of 2.3, a chip
  with and without the glyph, a cursor above the box and none). A change in what the shape does changes the version; a
  change in how it is spelled does not.

### 2.6 Three worked examples

Rows are shortened; each frame is a reduced frame of the part named. The first two are **inferred** from the recipe plan's
description of the two forms, not read off a recorded frame.

**Example 1: `rows-3@220x50`, the old form.**

```text
0  ╭──────────────────────────────╮     R:
1  │ ✻ Welcome to Claude Code!    │     X0|││   -> X+
2  │                              │     B|      -> B+
3  │   ‹working directory›        │     X0|││   -> X+
4  ╰──────────────────────────────╯     R:
5                                       B       -> B+
6  ────────────────────────────────     R:      (the box's top rule)
7  ❯ frames row 001 of 003 abcdefghij   G
8    frames row 002 of 003 abcdefghij   T
9    frames row 003 of 003 abcdefghij   T
10 ────────────────────────────────     R:
11   ccrc capture                       X2|
```

Cursor `[62, 9]`. Tokens: `R:`, `X+`, `B+`, `X+`, `R:`, `B+`, `R:`, `G`, `T`, `T`, `R:`, `X2|`, `@3,62`.

**Example 2: `rows-180@220x50`, the new form** (the operator's picture of the later build: the top rule carries
`↑ 156 more` and the first row in view has no glyph).

```text
...      banner and scrollback          X+ B+ ...
k    ──────── ↑ 156 more ────────       R:↑ 9 more   (the box's top rule)
k+1    frames row 157 of 180 abcd...    T
...    23 more rows of our text         T x 23
k+25 ────────────────────────────────   R:
k+26   ccrc capture                     X2|
```

Tokens from the top rule: `R:↑ 9 more`, then `T` 24 times, `R:`, `X2|`, `@24,62`. A build that drew the old form at this
part starts `R:`, `G`, `T`... instead, so its hash differs and `rows-180@220x50` is in `differing`.

**Example 3: `empty@220x50` with a ghost hint, and `chip@220x50`.**

```text
────────────────────────────────          R:
❯ ESC[2mTry "write a test"ESC[0m          G~        (the hint's words are dropped)
────────────────────────────────          R:
  ccrc capture                            X2|
```

Cursor `[2, 1]`. Tokens: `R:`, `G~`, `R:`, `X2|`, `@1,2`. A build whose hint says `Try "fix the build"` has the same shape: words are not
seen. The chip part's box row `❯ [Pasted text #1 +0 lines]` is `Cg:[Pasted text #9 +9 lines]`; a build that renamed the
label to `[Pasted content #1]` would give `G` instead, a new form.

### 2.7 Two questions for the coordinator (ruled)

**Ruled** (the coordinator's "step 1 ruled"): 2.2's anchor yes, with a probe and a case for one rule row and for three; the
label words kept; the two exports as one identical hunk on both branches, which wave 197's worker said yes to. The
questions as they were put:

1. **Rule label words.** Section 7 keeps a rule label's characters with every digit run as `9` (its example: `↑ 156 more`
   is `↑ 9 more`), and its "cannot see" list also says a label word change (`more` to `lines above`) is the same form.
   The two disagree. This plan keeps the label's words, by the example: the send's reader parses that label, and a change
   of its words is exactly what broke the send last time. The "cannot see" line in the note then says words of other rows,
   the banner and the hints are not seen, while a rule label's and a chip's words are. **Your ruling.**
2. **Two exports from the reducer**, which wave 197 is editing now (I read it and do not edit it): `T` must use the
   reducer's own rule 2 test, `rowIsOurs(plainRow, oursSquashed)`, and the squashed list is built inside `reduceOnce` by a
   private `squash`; and `X`'s edges need the reducer's private `spans`. I ask wave 197 to export `oursSquashed(ours)`
   (the `ours.map(squash).filter(...)` the reducer already computes, which it then calls itself) and `rowSpans(row)` (its
   `spans`), with no change to what the reducer does. Until they land I build against them by name.

## 3. The standing (`shared/framesStanding.ts`, L1, pure)

### 3.1 What the decider reads

`framesStandingAnswerOf(records, rows)`: `records` are the trust records (`ClaudeBuildRecord[]`, as the delivery
standing reads them), and `rows` are the store's text-free shape rows (section 4.2). The newest trusted build is
`deliveryLane.ts#newestTrustedBuild`, the one decider the delivery lane, the frames lane and the delivery standing all use,
so the read and the lanes never name different builds (pinned for every order of a mixed record list).

- **A part is current** when its row is at this side's `FRAMES_RECIPE_VERSION` with a word, a record and a time, as
  `framesLane.ts#isCurrentFrames` reads it.
- **A build is complete** when all 52 parts are current.
- **The build it is compared against** (`against`) is the newest build older than the newest trusted one that is
  complete, among the builds the read is bounded to (4.2), or null.
- **A frame is comparable** in a build when its part is current, its outcome is `drawn`, the receiver's check at store
  time was `clear`, and its stored shape is at this side's `FRAME_SHAPE_VERSION`.
- **Compared** frames are the frame ids comparable in both builds. **Differing** frames are the compared ones whose hashes
  differ, in part order.

### 3.2 The form word

| Newest build | `against` | Compared | Differing | Word |
|---|---|---|---|---|
| any | any | any | one or more | `new-form` |
| not complete | any | any | none | `incomplete` |
| complete | null | 0 | none | `first-form` |
| complete | a build | 0 | none | `not-compared` |
| complete | a build | 1 or more | none | `same-form` |

**Ruled** (the coordinator's ruling 4 on step 1): the fourth row is a fifth word, `not-compared`, so `first-form` means only
"no earlier complete build within the bound". The bullet below records the proposal as it was put.

- **`new-form` wins over `incomplete`.** The first differing part says so at once, before the other 51 are framed (about
  an hour of lane passes). That is the alarm's point. The differing list then holds what is measured so far.
- **The first three answers come first.** The capture owner measured, on 2026-11-28, no frame at all on record yet, so the
  status read meets `no-trusted-build`, `incomplete` and `first-form` long before two full sets. Each is cased as
  carefully as `new-form`: no row at all for the newest trusted build; rows that hold attempts only; rows at another
  recipe version; frames rows for a build that is not trusted; a complete newest build with no older one; one whose only
  older complete build is past the read's bound; one whose older complete build compares nothing.
- **`first-form` means nothing could be compared**: no earlier complete build, or one whose frames compare to none of the
  newest build's (another shape version, or every frame of one side refused). `against` says which: null, or the build.
  `same-form` never stands on zero compared frames. **Your ruling, if you want a fifth word for the second case.**

### 3.3 The refusals word

Over the newest build's current parts: `refused` are those whose outcome is `refused` or whose receiver check was not
`clear`; `overCap` are those whose outcome is `over-cap`.

| `refused` | `overCap` | Word |
|---|---|---|
| empty | empty | `none` |
| one or more | empty | `refused` |
| empty | one or more | `over-cap` |
| one or more | one or more | `refused-and-over-cap` |

An `unsettled` frame is in neither list and is not compared; the frames read shows it.

### 3.4 The four kinds and the one reader

```text
frames: { kind: 'standing', standing: {
            build, against: build | null, word, differing: frameId[],
            refusals, refused: frameId[], overCap: frameId[] } }
      | { kind: 'no-trusted-build' }
      | { kind: 'held' }                the recipe's hold is down (5.3, ruled); answered before either store read
      | { kind: 'unreadable' }          the store read threw; one log line, the error never on the wire
      absent                            an older server, or no coordination store: the reader answers 'unknown'
```

`readFramesStandingAnswer(v)` is the one reader, with the delivery standing's checks: each kind with exactly its own keys;
`build` and `against` the build grammar, `against` older than `build`; each word from its map; each id list a subset of the
recipe's frame ids (`framesResult.ts#framesPartOfId`), each id once, in part order; the form word agreeing with `differing`
and `against` (3.2's table read backwards); the refusals word agreeing with its two lists; `refused` and `overCap`
disjoint, and neither holding a differing id. Absent reads as `unknown`; anything else is `null`.

**What it carries.** Only fixed words, build names and frame ids. No shape token, no hash, no count and no text. A case
feeds frames whose reduced text holds a marker (in a row of our text and in a rule label) and finds the marker, the shape
tokens and the hashes in no serialised answer, through the decider and through the route. Size, by a case: at the worst
(52 differing, then 52 split between the two refusal lists of another standing) under 4 KiB.

### 3.5 Whether to shape (`framesShapeToStore`)

The lane asks the decider, never decides: `framesShapeToStore(result, checked)` answers `frameShape(text, cursor,
framesOurs(case, pane))` exactly when the outcome is `drawn`, the text is present and `checked` is `clear`, and null
otherwise. An unsettled, over-cap or refused frame, or one the server's check refused, is never shaped.

## 4. Storage (PACKET 1 to the capture owner)

### 4.1 The column and the migration

- **One additive column**, by its own migration at the next free slot when I push:
  `ALTER TABLE claude_build_frames ADD COLUMN shape TEXT;`. Its value is JSON written by the store,
  `{"version": <16 hex>, "hash": <16 hex>, "at": <the row's at>}`, or null. **No tokens** (the capture owner's change A,
  call 1963): no reader in this wave takes them, and a rule label's and a chip's words would stay in the database after
  that build's text is set aside, past the four-build bound. A later surface that wants a row-by-row difference computes
  the tokens again from the kept text with the pure rule. A case plants a marker in a rule label and finds it in no stored
  shape.
- **The slot.** `main` has 135 entries today (measured: `git show origin/main:server/src/coord/schema.ts | grep -c '^  //
  ── [0-9]*: user_version'` printed 135), so 136 is free on `main`, but another open PR names 136. I re-measure at the
  push, mail the number to the coordinator before it, and re-derive the count suites on that merged tree.
- **An older build** opening the file at this version takes `db.ts` rule 3 (it warns, reads as-is and migrates nothing)
  and never names the column. Its `recordFrames` upsert does not set `shape`, so a part it re-records keeps a stale shape:
  that is why the shape carries the row's `at`, and the store reads a shape whose `at` is not the row's as no shape. A
  case drives an upsert without the column and finds the part unshaped.
- **The coordination database still refuses to start rather than open empty.** No change to the migration runner; the
  count suites move by one.

### 4.2 The store (`coord/claudeBuildFramesStore.ts`, `CoordStore` delegates)

- `recordFrames(db, r, checked, now, drop, shape)`: the one upsert sets `shape` from the decider's answer (`null` writes
  null), with `at = now` inside it. Still the table's one writer, the capture lane its one caller.
- **A new text-free read, bounded by builds** (the capture owner's change B, call 1963), `claudeBuildFrameShapes(db,
  builds)`: `build, part, version, word, record, checked, at, shape` of the named builds' rows only (the primary key leads
  with the build), never `text`, parsed by the same helpers as `claudeBuildFrames` (the record by the one result reader,
  the words by their maps), and the shape read as `{version, hash}` only when its JSON reads whole and its `at` is the
  row's. The builds come from a pure step in `framesStanding.ts`, `framesStandingBuilds(records)`: the newest trusted build
  and the `FRAMES_STANDING_OLDER` (4) newest trusted builds older than it, only trusted builds ever being framed. A
  complete build older than that is not read, and the standing then says `first-form` with `against` null. Cases: a row
  of a build past the bound is not returned, and the standing over a table of many builds equals the standing over the
  bounded rows. The note gives the read's cost at the bound. It returns
  `FramesShapeRow[]`, a type of its own in `framesStanding.ts`, so "no text" is never spelled as `text: null`, which
  already means "set aside" (no overloaded null). The status read runs every 30 seconds while the console's test box card
  is open, so it must not read up to 14 MiB of text each time; this read is why the store changes.
- Cases: the column written and read back; the `at` binding; an unreadable shape read as none, never an error; the read
  never selects `text` (a case plants a text marker and finds it in no returned row).

## 5. The lane and the status read (PACKETS 2 and 3 to the capture owner)

### 5.1 The lane (`server/src/buildCaptureLane.ts`, packet 2)

- In `framesPass`, after the receiver's check: `const shape = framesShapeToStore(result, checked)`, passed to
  `recordFrames`. No other change to what the lane decides or sends.
- **The warn line** (carried from #3487's reviews): where the lane now returns silently on
  `result.version !== FRAMES_RECIPE_VERSION`, it first writes
  `ccrc-server: frames capture: <build> part <part>: the test box ran frames recipe version <box>, this server's is
  <server>; no row is stored, asked again after the spacing`. Both versions are 16 hex by the reader's own check, so the
  line holds only fixed words, a build, a part and two hex words. A case feeds a result at another version and finds
  exactly that one line and no row; the mutant that drops the line is red.

### 5.2 The status read (`server/src/coord/routes.ts`, packet 3)

- `GET /api/testbox` answers `frames` beside `delivery`, by the same pattern: with a coordination store,
  `framesStandingAnswerOf(records, coord.claudeBuildFrameShapes(framesStandingBuilds(records)))`, with
  `records = coord.claudeBuilds()`, inside a try; a throw answers
  `{kind: 'unreadable'}` with one log line naming the read and the error message, never on the wire; with no store the
  key is absent. The block and `delivery` are answered either way.
- No new route, no new credential, no gate row, no client verb: the census and the gate's counts do not move (re-run to
  show it). The answer passes the one answer hook as the read does today.
- Cases: the standing through the route with a session and with the box token; no store, key absent; a throwing store,
  `unreadable` with one log line and the block still answered; the marker case through the route.

### 5.3 Would the warn line, or a hold beside it, have kept an unfinished recipe from running? (the coordinator's 40919)

**No, neither.** Between the recipe's release and its width follow-up, the server and the test box held the SAME recipe
version, so `result.version !== FRAMES_RECIPE_VERSION` was false: the warn line would have stayed silent, and a hold that
declines parts from a box whose version is not the server's would have declined nothing. What kept that recipe from
running was only the build's absence on the box.
- **What the mismatch already does.** A result at another version is not stored today; the lane drops it. So a mismatch
  hold would add only that the job is not SENT, which needs the box's version before the send (a new field on the
  capture path), and would save test box time during a rollout, when the two stand apart for hours (the owner's
  measurement). It buys no safety the drop does not already give.
- **What would cover the case.** A hold of the recipe's own, independent of the versions. The cheapest is a constant in
  the recipe's case file, `FRAMES_RECIPE_COMPLETE`, read by `framesLane.ts#nextFramesJob`, which a pull request that ships
  an unfinished recipe sets false and its follow-up sets true: one constant, one decider line, one case, no runtime
  switch and no operator act; but it is a request a reviewer must catch, not a mechanism. The other is a lane arm
  (the Shadow lanes card's switch), a runtime mechanism that costs the operator an act per recipe, which the standing
  directives argue against. **Not built**: the coordinator rules first, and either one touches the owner's lane and goes
  to it as a packet.
- **Ruled and built** (the coordinator's "the hold ruled"; the capture owner's packet 4, call 1966, and call 1968): the
  constant, read by the server's job decider (no job), by the status read's decider (`{kind: 'held'}`, before either store
  read), and by the test box's own desk (the submission refused at the frame with the existing words), never by the fleet
  agent's forwarding arm. The task note states the property in three lines.

## 6. The settings case (agent)

`agent/test/testbox-capture-runner.test.ts` gains a case with a watching launcher, the pattern of its environment cases:
at the build's start it reads `<CLAUDE_CONFIG_DIR>/settings.json`, the file the runner wrote, and holds that its
`statusLine` is `{type: 'command', command: <the recorder> statusline}`, that every capture event has its hook, and that
running the status line's command prints `STATUSLINE_REPLY`, which equals `FRAMES_STATUS_TEXT`. A runner that writes the
settings without the status line is red.

## 7. What the alarm cannot see (for the note)

It says "changed", never "fine".
- Words of other rows: the banner, hints, notices, an earlier turn's marker text. Only a rule label's and a chip's words,
  with digits as `9`, are kept (if 2.7's question 1 is ruled the other way, a rule label's words go too).
- Behaviour a settled frame does not show: when an Enter submits, paste detection's timing, key handling, what the send
  does next. The delivery recipe measures the send.
- Anything outside the 52 frames: other sizes and drafts, macOS, a real model or account.
- Colour, except dim on chip, glyph and our-text rows.
- A change inside a row the reducer replaced: it keeps its class.
- A short other row whose text, spaces removed, happens to be a run of one of our texts reads as `T`, by the reducer's own
  rule 2 test (measured: a lone `a` is a run of the drafts' filler). Two builds that draw such a row alike still agree.
- An unsettled, refused or over-cap frame is not compared (the refusals word reports the last two).
- Two builds wrong in the same way.
- Across a recipe version change: older builds are never framed again (no back-fill), so the first build framed at a new
  recipe version is `first-form` against nothing. Wave 197 changes the reducer, so the first build after it lands reads
  `first-form`. Across a shape version change, the same: a stored shape at another shape version compares nothing, and
  rows recorded before this migration have no shape.
- `against` is the newest older COMPLETE build: a build superseded before its 52 parts finished is never compared.

## 8. Departures to record (each "legitimately different", for the ledger)

- **frames-shape-chip-label**: the paste label's pattern in `framesShape.ts` beside the send's `PASTE_CHIP`, because an L0
  file cannot import `server/src`; a text case holds the two equal.
- **frames-shape-dim-walker**: the shape reads one row's dim attribute by walking its SGR state, a different question from
  the send's `undim` (which removes dim runs from a draft), and on the other side of the ring boundary.
- **frames-shape-text-free-read**: a second read of `claude_build_frames`, text-free, because the status read runs every
  30 seconds and the table holds up to 14 MiB of text; the same owner, the same parsing helpers.
- **frames-shape-anchor**: the box's top rule as the collapse anchor instead of section 7's "last R-over-G pair" (2.2),
  subject to the coordinator's ruling.

## 9. Tasks

Each guard ships with the case that goes red without it, by name, measured, listed in the note as replayable rows. Every
run goes through `ccrc test --local`, in the foreground, one at a time.

- [ ] **A0.** Print `DELIVERY_RECIPE_VERSION` (`da16fe2f55551e0b`) and `FRAMES_RECIPE_VERSION` before the first edit.
- [ ] **A1.** `shared/framesShape.ts` and `server/test/frames-shape.test.ts`: each class, the precedence, the two
  skeletons, the collapse and its anchor, the dim walker (with the colour-index trap), the cursor, the three examples, the
  version from its probes, the hash. Red first, case by case. (Before the rulings, by the brief.)
- [ ] **A2.** `shared/framesStanding.ts` and `server/test/frames-standing.test.ts`: `framesShapeToStore`, the decider over
  every row of 3.2 and 3.3, the same-build-as-the-lanes case, the one reader's checks, the marker case, the size bound.
- [ ] **A3.** Packet 1, then on the owner's yes: the migration, the store's column, `recordFrames`' shape, the text-free
  read, the delegates; `frames-lane-store.test.ts` cases; the migration count suites re-derived.
- [ ] **A4.** Packet 2, then on its yes: the lane's shape and the warn line; `frames-lane-capture.test.ts` cases.
- [ ] **A5.** Packet 3, then on its yes: the status read's `frames`; its route cases.
- [ ] **A6.** The agent's settings case.
- [ ] **A7.** The task note (`docs/superpowers/programs/desktop-polish/box-frames-alarm.md`) with what the alarm cannot see,
  the mutation table, the departures, and `DELIVERY_RECIPE_VERSION` printed again. The evidence runs of the brief on my
  head merged with current `main`. The merge probe, the slot mailed, one push, a draft PR.

## Deviations found

None yet. A deviation found is mailed to the coordinator, who issues its number. No placeholder number goes in the tree.

## Where things stand

- **Agreed:** section 7 of the recipe plan, in substance (the capture owner); the brief's scope and limits.
- **Agreed by the capture owner** (call 1963): packets 2 and 3 as sent; packet 1 with its two changes, no stored tokens
  and a read bounded by builds, both written into section 4.
- **Agreed by the coordinator** ("step 1 ruled", "the hold ruled"): the anchor, the label words, the reducer's two exports
  as one identical hunk, the fifth word `not-compared`, and the hold as a constant; and by the capture owner, packet 4 with
  its three conditions and the box-side hold (calls 1966 and 1968).
- **Waiting on you:** nothing in step 1. The migration slot is mailed to the coordinator before the push.
- **Later:** a console surface for frames; a generated mark table for the reducer (wave 197's).
