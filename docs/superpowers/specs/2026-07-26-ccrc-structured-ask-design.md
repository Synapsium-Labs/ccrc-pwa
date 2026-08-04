# ccrc — structured questions in the dialog sheet

**Status:** approved design, 2026-07-26. Revised after an adversarial review pass;
the correlation rule below was rewritten outright because the first version was
measurably unsound against the real transcript corpus.

Sibling of [the attachment tray](2026-07-26-ccrc-attachment-tray-design.md) — same
session's complaint, separate design, but **not parallel-safe. Implement the tray
first.** They share three things:

- `shared/api.ts` — the tray adds `StagedClip` / `composePrompt` /
  `splitClipPaths` (turning a pure-type module into one with runtime code); this
  spec adds `AskOption` / `AskQuestion` and a field on `Dialog`.
- `pwa/test/chat.test.tsx` — both add cases to it.
- The chat render path — the tray changes the `ChatList` / `ChatListInner`
  signature to thread `id` down to `MessageBubble`; this spec rewrites
  `ToolCard`'s `AskUserQuestion` branch in the same tree.

## The problem

When Claude asks a question through `AskUserQuestion`, the PWA doesn't read the
question — it **screen-scrapes the terminal that is rendering the question**.

For a question whose options carry `preview` blocks, the TUI switches to a
two-column layout: options wrapped down the left, and only the **currently
selected** option's preview in a box on the right
(`server/test/fixtures/panes/ask-2col-chat-about.txt` is exactly this shape).
`parseDialog` cannot attribute that box to an option, so it gives up on detail:

- `pane/dialog.ts:136` — in two-column mode every option is emitted with
  `description: undefined`. **Every description is dropped.**
- Only one preview is ever on screen, so **every preview is dropped.**
- What reaches the sheet is three bare labels. The escape hatch, "Show full
  question", dumps a 200-column terminal capture into a phone-width `<pre>`.
- The same question renders a second time in the chat as a generic `ToolCard`
  whose summary is the first line of raw JSON (`ToolCard.tsx:47`).

So the operator chooses between labels with the reasoning removed.

Meanwhile the complete question — every label, description and preview — is
already in the transcript as the `AskUserQuestion` `tool_use` block, and
`sessionws.ts` holds the pane capture and the transcript tailer in the same
object (`sessionws.ts:6-7,89`). It scrapes ASCII with the real data in hand.

The tool input's shape, read from a live transcript:

```
input = { questions: [ { question, header, multiSelect,
                         options: [ { label, description, preview } ] } ] }
```

## The design

**The pane says *that* a question is up and answers it. The transcript says
*what* it is.**

### Why not the chat event

The stream already carries `tool_use` events with an `input` string — but
`transcript/parse.ts:4` caps it at `TOOL_INPUT_MAX = 4000`. The question that
prompted this spec serialised to **4572 bytes**, so its own payload was already
truncated. The dialog must read the JSONL directly, untruncated.

### Shared contract

```ts
export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
}
```

`Dialog` gains `ask?: AskQuestion` — present when the live menu is an
`AskUserQuestion`, absent for scraped confirms (`/model`, `/effort`, permission
prompts), which keep working exactly as today.

### Server

1. **`server/src/transcript/ask.ts`** (new) —
   `readPendingAsk(io, file): Promise<AskQuestion[] | null>`. Read the transcript
   tail (last ~256 KB) and find the `AskUserQuestion` `tool_use` that is still on
   screen. Two gates, both required:

   - **No `tool_result` for its `tool_use_id`.** Necessary but *not sufficient* —
     see below.
   - **It must be the last conversational line in the tail: no line of `type`
     `user` or `assistant` may appear after it.** State this as a **denylist over
     `{user, assistant}`, never an allowlist of permitted types.** Across this
     fleet, line types that legitimately appear between an `AskUserQuestion`
     `tool_use` and its result include `attachment`, `system`, `ai-title`, `mode`,
     `queue-operation`, `pr-link`, `permission-mode` and `worktree-state`. As an
     allowlist that list wrongly rejects 31 of 486 real answered asks (6%); as a
     denylist the guard is 486/486 correct. The list is open-ended — the harness
     adds line types across versions — which is itself the argument for the
     denylist.
   - The scan compares **line positions, not message ids**: Claude Code splits one
     assistant message across consecutive lines (thinking, thinking, tool_use) all
     carrying the same `message.id`.

   **Why the adjacency guard is required.** "No `tool_result`" is a good first
   gate but not a sound signal, and the fleet already contains the counterexample:
   `~/.claude-gpt/projects/…-frontend-ui-foundation/eed32463….jsonl:5717` is a
   2-option ask whose session was restarted while the menu was up (written under
   Claude Code 2.1.216; the next `user` line is seven minutes later under 2.1.217).
   It never gets a result, and the file continues for another 765 lines over three
   days. Transcripts are resume-appended, not rotated, so an ask abandoned by a
   kill, OOM or restart stays "unanswered" **forever** in the file
   `readPendingAsk` reads — and immediately after such a restart it is well inside
   the 256 KB window. Without adjacency, a later unrelated menu gets enriched with
   a question that no longer exists.

   Parse `input.questions` defensively — any malformed shape returns `null` and the
   sheet degrades to today's behaviour. Never throws.

2. **`sessionws.ts` `checkDialog(file: string | null)`** — the signature has to
   change: today `checkDialog()` takes no arguments (`sessionws.ts:86`) and the
   class stores only `uuid` (`:33`); `file` is a local of `resolve()`, recomputed
   each tick from the live cwd (`:152`). Pass `r?.file ?? null` from the `start()`
   call at `:75` (where `resolve()` may have returned null — send the dialog, skip
   the ask) and `r.file` from `:209`. Which file is not incidental: after an
   account swap the same `uuid.jsonl` exists under several wrapper config dirs, so
   the ask must be read from the same file the stream is tailing.

### Matching the question to the menu

This is the part the first draft got wrong. The rule is a **head-anchored pairwise
alignment**, not a ratio.

Let `n = ask.options.length`. Normalise both sides (lowercase, collapse
whitespace) and compare scraped rows `1..min(n, rows)` to `ask.options[0..n-1]`
**pairwise by position**. A pair matches when either side is a prefix of the other
— the scraped side can be truncated by `leftCol` at a run of two spaces or at the
two-column gutter.

- **Ignore every scraped row past `n`.** Those are the TUI's own rows, and their
  shape differs by layout: in one-column mode they are *themselves numbered* and
  fold into the same contiguous run (`ask-user-question-real.txt:30` is
  `4. Type something.` and `:32` is `5. Chat about this` — for a **three**-option
  ask), while in two-column mode `Chat about this` is unnumbered and
  `parseDialog` appends it anyway (`dialog.ts:151-160`). So "scraped numbered
  rows" is 5 in one layout and 3 in the other for the same question, and nothing
  in `Dialog.options` marks which rows are the TUI's. That is why a denominator
  cannot be defined and the first draft's "at least half" rule was unimplementable
  as well as unsafe.
- **Require *all* positions to match when `n ≤ 3`; allow at most one mismatch only
  when `n ≥ 4`.** Never express this as a fraction: 297 of 1039 real questions in
  this corpus have exactly two options, where "half" means one coincidental label
  is sufficient evidence.
- **Require exactly one question in the `tool_use` to satisfy the alignment.** A
  multi-question call gets exactly **one** `tool_result`, written only after the
  **last** question is answered, so all N questions look pending simultaneously and
  there is no ordering signal to skip the answered ones. This is a main path, not
  an edge: 152 of 817 real asks in this fleet are multi-question (19%, up to four
  questions).
- **On a tie, break on the `question` text against the scraped `Dialog.body`** —
  not `title`. With a footer present, `title` is only the last physical line above
  the options (`dialog.ts:183-188`), so a wrapped question loses its head; `body`
  carries the whole preamble.
- **Still ambiguous → no `ask`,** i.e. today's sheet.

### Index mapping is pane-authoritative

The load-bearing safety property. The scraped `Dialog.options` continue to drive
the arrow-walk; `ask.options` only **enriches by position** — scraped row *k* takes
`ask.options[k]`, and rows past `ask.options.length` (the TUI's `Type something.` /
`Chat about this`) keep their scraped labels and indices untouched.

A parser or TUI-layout mismatch can therefore degrade the copy, but can never
send the wrong keystrokes.

`multiSelect: true` questions already come back `unparsed` from the pane (they
need Space-to-select, `dialog.ts:66`). Out of scope: the raw sheet and the
terminal escape hatch stand.

### The send gate must be upgrade-only

`Dialog.id` stays purely pane-derived — `answerDialog`'s staleness check re-parses
the pane, so folding `ask` into the hash would break it, and the PWA's
`dismissedId` / `answering` keying (`DialogSheet.tsx:53-58`) depends on it too.

But the frame gate needs fixing. `checkDialog` sends only when
`this.lastDialogId !== dialog.id` (`sessionws.ts:91`). If the *first* poll that
sees the menu fails to read the ask — transcript not yet flushed, `resolve()`
momentarily on a pre-rotation uuid, a transient remote-IO null — the bare dialog
goes out, `lastDialogId` is set, and every later poll that *does* find the ask is
suppressed **permanently**, not until the next tick.

Making the key two-way (`dialog.id + (ask ? ':ask' : '')`) fixes the miss but
introduces flapping: a flaky read then alternates enriched and bare frames every
2 s, and the bare one strips descriptions and previews off a sheet the operator is
mid-read on, re-collapsing the preview wells. So instead **latch the enrichment**:
track `lastDialogId` plus `lastAsk: AskQuestion | null`, reset `lastAsk` to null
whenever `dialog.id` changes. Send when the id changes (new menu) **or** when a
freshly-read `ask` arrives and `lastAsk` was null (the upgrade). When an ask read
comes back null or no-match for an unchanged, already-enriched id, reuse the
cached `lastAsk` and send nothing — a transient read failure must never downgrade
what is on screen.

### PWA

**`DialogSheet.tsx`**

- Eyebrow stays `claude is asking`; `ask.header` joins it as an uppercase mono
  chip. This needs the shared primitive: `Sheet`'s prop is `eyebrow?: string`
  (`Sheet.tsx:16`) rendered as `<p className="sheet-eyebrow">{eyebrow}</p>`
  (`:39`), so **add `pwa/src/components/Sheet.tsx` to the change list and widen
  `eyebrow?: string` to `eyebrow?: ReactNode`.** Purely additive — all seven
  existing call sites pass strings and keep compiling; optionally tighten the
  `eyebrow !== undefined` guard to a truthiness check, since `ReactNode` admits
  null.
- Title becomes `ask.question` (the real, untruncated question) when present.
- The scraped preamble `body` is dropped when `ask` is present — the question is
  authoritative and the preamble is a lossy copy of it. Kept otherwise.
- Option rows carry the full `description` as multi-line sans 13px in
  `--ink-secondary`, under the label.
- `preview` renders in a dark well beneath its row: `<pre>` at mono 11px with
  `overflow-x: auto` and no wrapping — fixed-width ASCII must scroll, the same
  rule code blocks already follow — capped at `--well-max` with internal scroll.
  A `▾ preview` toggle collapses it; **the preselected row's preview starts
  expanded**, the rest collapsed.
- "Show full question" survives as the last resort, demoted below the reply form
  when `ask` is present.
- `Notes: press n to add notes` is out of scope.

**`ToolCard.tsx`** — `AskUserQuestion` gets a purpose-built row instead of a JSON
summary: a `❓` glyph, the first question's text as the summary, and once the
`tool_result` lands, the chosen answer as the result line. Input parsing is
defensive (it may be truncated); on failure it falls back to today's generic row.
This removes the duplicate JSON blob from the transcript.

**`chat.css`** — `.dlg-header-chip`, multi-line `.opt-desc`, `.opt-preview` well
and toggle, `.tool-ask`.

## Testing

- `server/test/ask.test.ts` (new) — pending vs. answered detection; an input larger
  than `TOOL_INPUT_MAX` parses whole; malformed input → `null`; no
  `AskUserQuestion` in the tail → `null`; a multi-question input returns all of
  them; **an abandoned ask followed by a later `user` line is not pending**; a
  `tool_use` followed only by `attachment` / `mode` / `ai-title` lines *is*
  pending; consecutive lines sharing one `message.id` don't defeat the adjacency
  scan.
- `server/test/sessionws.test.ts` — the dialog carries `ask` when the pane fixture
  aligns; no `ask` for a `/model`-style confirm; no `ask` when two questions both
  align; scraped rows past `ask.options.length` keep their labels; **`Dialog.id` on
  the wire is identical with and without `ask`**; **an ask that only becomes
  readable on a later poll is still delivered**; **a later poll whose ask read
  fails does not resend a bare dialog for the same menu**.
- `server/test/fixtures/transcript-ask-2col.jsonl` (new) — paired with the existing
  `ask-2col-chat-about.txt`. No new pane fixture is needed: that one is already a
  live capture, documented at `dialog.test.ts:128-130` as "Captured from
  cc-claude-corp-data-internal while it was actually asking". The transcript
  fixture's labels must be **longer than the pane's truncated rows**, not equal to
  them — the three labels in that pane round-trip out in full, so a fixture using
  those exact strings passes under strict equality and never exercises the prefix
  rule.
- `pwa/test/dialog-sheet.test.tsx` — question, header chip and descriptions
  render; preview toggles; the preselected preview is open on mount; enrichment
  aligns by position; extra rows keep their scraped labels; with no `ask` the
  sheet renders exactly as before.
- `pwa/test/chat.test.tsx` — the ask ToolCard, and its fallback on truncated
  input.

## Risk

- **False correlation** — guarded by three independent conditions: an unanswered
  `AskUserQuestion` `tool_use`, adjacency (nothing conversational after it), and a
  strict head-anchored alignment that must select exactly one question.
- **Transcript lag** — the assistant message carrying the `tool_use` is persisted
  before the menu renders, so the payload is normally there by the time a menu is
  detected. When it isn't, the upgrade-only gate delivers the enrichment on a later
  poll instead of losing it.
- **Layout drift** — a future TUI layout change degrades enrichment to no-match,
  never to wrong keystrokes, because indices stay pane-derived.
