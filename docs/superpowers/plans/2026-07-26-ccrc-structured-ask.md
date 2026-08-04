# ccrc Structured Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude asks a question, show the real question — every option's description and preview — instead of the bare labels left over from screen-scraping a terminal.

**Architecture:** The pane keeps two jobs: saying *that* a menu is up, and answering it by arrow-walk. What the question *is* comes from the transcript, where `AskUserQuestion`'s `tool_use` block already holds the whole thing. The server correlates the two and ships a `Dialog.ask`; the sheet renders it. Indices stay pane-derived, so a mismatch can only cost copy, never send a wrong keystroke.

**Tech Stack:** TypeScript, Fastify, React 19, vitest (+ @testing-library/react, jsdom).

**Spec:** [`docs/superpowers/specs/2026-07-26-ccrc-structured-ask-design.md`](../specs/2026-07-26-ccrc-structured-ask-design.md)

## Global Constraints

- **Run [`2026-07-26-ccrc-attachment-tray.md`](2026-07-26-ccrc-attachment-tray.md) first.** Not parallel-safe: both edit `shared/api.ts` and `pwa/test/chat.test.tsx`, and the tray changes the `ChatList` → `MessageBubble` signature this plan's `ToolCard` work sits beside.
- Baseline: **server 173, agent 82, pwa 169** before the tray plan; re-baseline from wherever the tray left them.
- Run suites from the package dir: `npx vitest run` in `infra/ccrc/{server,agent,pwa}`.
- No new runtime dependencies.
- **`Dialog.id` must stay purely pane-derived.** `answerDialog` re-parses the pane to check staleness, and `DialogSheet.tsx:53-58` keys `dismissedId` / `answering` off it. Folding `ask` into the hash breaks both.
- **Never let `ask` change which keystrokes an answer sends.** Enrichment is by position only.
- `multiSelect: true` asks are out of scope — the pane already returns them `unparsed` (`dialog.ts:66`), and the raw sheet plus terminal escape hatch stands.

---

## File Structure

**Shared** — `infra/ccrc/shared/api.ts`: `AskOption`, `AskQuestion`, `Dialog.ask?`.

**Server**
- `server/src/transcript/ask.ts` — **new.** `readPendingAsk` (find the on-screen ask) and `alignAsk` (pick which question it is). Pure enough to test hard.
- `server/src/sessionws.ts` — `checkDialog(file)`, the enrichment latch.

**PWA**
- `pwa/src/components/Sheet.tsx` — `eyebrow` widens to `ReactNode`.
- `pwa/src/session/DialogSheet.tsx` — question, header chip, descriptions, preview wells.
- `pwa/src/session/ToolCard.tsx` — a readable ask card instead of raw JSON.
- `pwa/src/session/chat.css` — the new pieces.

---

## Task 1: Shared contract

**Files:**
- Modify: `infra/ccrc/shared/api.ts`
- Test: none (types only; exercised from Task 2 on).

**Interfaces:**
- Produces:

```ts
export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
}
```
and on `Dialog`: `ask?: AskQuestion;`

- [ ] **Step 1: Add the types**

Append the two interfaces to `shared/api.ts` and add to the existing `Dialog`:

```ts
  /** The real question, when the live menu is an AskUserQuestion and the
   *  transcript could be matched to it. Absent for scraped confirms (/model,
   *  /effort, permission prompts), which render exactly as they do today. */
  ask?: AskQuestion;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd infra/ccrc/server && npx tsc --noEmit` → clean.
Run: `cd infra/ccrc/pwa && npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add infra/ccrc/shared/api.ts
git commit -m "feat(ccrc): AskQuestion on the Dialog contract"
```

---

## Task 2: Find the question that is actually on screen

**Files:**
- Create: `infra/ccrc/server/src/transcript/ask.ts`
- Create: `infra/ccrc/server/test/ask.test.ts`

**Interfaces:**
- Consumes: `AskQuestion` (Task 1), `FleetIO`.
- Produces: `readPendingAsk(io: FleetIO, file: string): Promise<AskQuestion[] | null>`.

Two gates, both required:

1. **No `tool_result` for the `tool_use_id`.** Necessary, not sufficient.
2. **Nothing conversational after it** — no line of `type` `user` or `assistant`.
   State this as a **denylist over `{user, assistant}`, never an allowlist.** Real
   transcripts put `attachment`, `system`, `ai-title`, `mode`, `queue-operation`,
   `pr-link`, `permission-mode` and `worktree-state` lines between a `tool_use` and
   its result; as an allowlist the guard wrongly rejects 6% of real answered asks,
   as a denylist it is 486/486 correct. The list is open-ended — the harness adds
   types across versions — which is the whole argument for the denylist.

Gate 2 exists because gate 1 is unsound alone: a session restarted while a menu was
up leaves an ask with no result **forever** (transcripts are resume-appended, never
rotated). There is a real instance of this in the fleet.

Compare **line positions, not message ids** — Claude Code splits one assistant
message across consecutive lines (thinking, thinking, tool_use) sharing a
`message.id`.

- [ ] **Step 1: Write the failing test**

```ts
// Which AskUserQuestion is on screen right now. The transcript is append-only and
// survives restarts, so "has no tool_result" is necessary but nowhere near
// sufficient — an ask abandoned by a kill stays resultless forever.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readPendingAsk } from '../src/transcript/ask.js';

const ASK = (id: string, question = 'Which colour?') => JSON.stringify({
  type: 'assistant', uuid: 'a1', timestamp: '2026-07-26T15:00:00Z',
  message: { id: 'msg_1', role: 'assistant', content: [{
    type: 'tool_use', id, name: 'AskUserQuestion',
    input: { questions: [{
      question, header: 'Colour', multiSelect: false,
      options: [
        { label: 'Red', description: 'Warm, high-energy.', preview: '┌──┐\n│  │\n└──┘' },
        { label: 'Green', description: 'Natural, calm.' },
      ],
    }] },
  }] },
});
const RESULT = (id: string) => JSON.stringify({
  type: 'user', uuid: 'u1', timestamp: '2026-07-26T15:01:00Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] },
});
const LINE = (type: string) => JSON.stringify({ type, uuid: 'x', timestamp: '2026-07-26T15:00:30Z' });
const USER_TEXT = JSON.stringify({
  type: 'user', uuid: 'u9', timestamp: '2026-07-26T15:02:00Z',
  message: { role: 'user', content: 'something else entirely' },
});

const fileWith = (lines: string[]): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-ask-'));
  const f = path.join(dir, 't.jsonl');
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
};

describe('readPendingAsk', () => {
  it('returns the question when the ask is unanswered and last', async () => {
    const qs = await readPendingAsk(localIO, fileWith([ASK('t1')]));
    expect(qs).toHaveLength(1);
    expect(qs![0]!.question).toBe('Which colour?');
    expect(qs![0]!.header).toBe('Colour');
    expect(qs![0]!.options[0]).toEqual({
      label: 'Red', description: 'Warm, high-energy.', preview: '┌──┐\n│  │\n└──┘',
    });
  });

  it('returns null once the ask has been answered', async () => {
    expect(await readPendingAsk(localIO, fileWith([ASK('t1'), RESULT('t1')]))).toBeNull();
  });

  it('ignores non-conversational lines after the ask', async () => {
    const qs = await readPendingAsk(localIO, fileWith([
      ASK('t1'), LINE('attachment'), LINE('mode'), LINE('ai-title'), LINE('worktree-state'),
    ]));
    expect(qs).toHaveLength(1);
  });

  it('treats an ask abandoned by a restart as gone, not pending', async () => {
    // No tool_result anywhere — but the conversation moved on, so the menu is not
    // on screen. This is a real shape: session killed while the menu was up.
    expect(await readPendingAsk(localIO, fileWith([ASK('t1'), USER_TEXT]))).toBeNull();
  });

  it('parses an input larger than the chat stream’s 4000-char cap', async () => {
    const big = JSON.parse(ASK('t1')) as Record<string, never>;
    // Pad a preview past TOOL_INPUT_MAX; the dialog must not read the truncated
    // chat event, so this has to survive whole.
    const q = (big as never as { message: { content: { input: { questions: Array<{ options: Array<{ preview?: string }> }> } }[] } })
      .message.content[0]!.input.questions[0]!;
    q.options[0]!.preview = 'x'.repeat(6000);
    const qs = await readPendingAsk(localIO, fileWith([JSON.stringify(big)]));
    expect(qs![0]!.options[0]!.preview).toHaveLength(6000);
  });

  it('returns null for a malformed input, a non-ask tool, and a missing file', async () => {
    const bad = JSON.stringify({
      type: 'assistant', uuid: 'a1', timestamp: 't',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { nope: 1 } }] },
    });
    expect(await readPendingAsk(localIO, fileWith([bad]))).toBeNull();
    expect(await readPendingAsk(localIO, fileWith([LINE('system')]))).toBeNull();
    expect(await readPendingAsk(localIO, '/nope/missing.jsonl')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ask.test.ts`
Expected: FAIL — cannot resolve `../src/transcript/ask.js`.

- [ ] **Step 3: Implement**

```ts
// Which AskUserQuestion is on screen. The chat stream can't answer this: it caps
// tool inputs at TOOL_INPUT_MAX (4000), and a real question with previews runs
// past that — the one that motivated this feature serialised to 4572 bytes. So
// read the JSONL directly, untruncated.
import type { AskQuestion } from '../../../shared/api.js';
import type { FleetIO } from '../io.js';

/** Enough tail to hold the current turn comfortably. */
const TAIL_BYTES = 256 * 1024;

/** Line types that mean the conversation moved on. Everything else — attachment,
 *  system, ai-title, mode, queue-operation, pr-link, permission-mode,
 *  worktree-state, and whatever the harness adds next — is noise between a
 *  tool_use and its result. A DENYLIST on purpose: as an allowlist this guard
 *  wrongly rejects 6% of real answered asks, and the type list keeps growing. */
const CONVERSATIONAL = new Set(['user', 'assistant']);

function parseQuestions(input: unknown): AskQuestion[] | null {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const raw of qs) {
    const q = raw as { question?: unknown; header?: unknown; multiSelect?: unknown; options?: unknown };
    if (typeof q.question !== 'string' || !Array.isArray(q.options)) return null;
    const options = q.options.map((o) => {
      const opt = o as { label?: unknown; description?: unknown; preview?: unknown };
      return {
        label: typeof opt.label === 'string' ? opt.label : '',
        description: typeof opt.description === 'string' ? opt.description : undefined,
        preview: typeof opt.preview === 'string' ? opt.preview : undefined,
      };
    });
    if (options.some((o) => o.label === '')) return null;
    out.push({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options,
    });
  }
  return out;
}

/**
 * The AskUserQuestion still awaiting an answer on screen, or null.
 * Never throws — a malformed transcript degrades to "no structured question",
 * and the sheet falls back to the scraped pane.
 */
export async function readPendingAsk(io: FleetIO, file: string): Promise<AskQuestion[] | null> {
  const stat = await io.stat(file);
  if (stat === null) return null;
  const from = Math.max(0, stat.size - TAIL_BYTES);
  const chunk = await io.readFileFrom(file, from);
  if (chunk === null) return null;

  const lines = chunk.data.split('\n');
  if (from > 0) lines.shift();   // the tail almost certainly cut a line in half

  let found: { at: number; id: string; questions: AskQuestion[] } | null = null;
  const answered = new Set<string>();
  const conversationalAt: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    let o: { type?: unknown; message?: { content?: unknown } | null };
    try { o = JSON.parse(line); } catch { continue; }
    const type = typeof o.type === 'string' ? o.type : '';
    if (CONVERSATIONAL.has(type)) conversationalAt.push(i);
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown> | null>) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') answered.add(b.tool_use_id);
      if (b?.type === 'tool_use' && b.name === 'AskUserQuestion' && typeof b.id === 'string') {
        const questions = parseQuestions(b.input);
        if (questions) found = { at: i, id: b.id, questions };
      }
    }
  }

  if (found === null) return null;
  if (answered.has(found.id)) return null;
  // Gate 2: nothing conversational after it. Line positions, not message ids —
  // one assistant message spans consecutive lines (thinking, thinking, tool_use).
  if (conversationalAt.some((at) => at > found!.at)) return null;
  return found.questions;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/ask.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/transcript/ask.ts infra/ccrc/server/test/ask.test.ts
git commit -m "feat(ccrc): read the on-screen AskUserQuestion from the transcript"
```

---

## Task 3: Decide which question the menu is showing

**Files:**
- Modify: `infra/ccrc/server/src/transcript/ask.ts`
- Test: `infra/ccrc/server/test/ask.test.ts`

**Interfaces:**
- Consumes: `AskQuestion` (Task 1), `Dialog['options']`.
- Produces: `alignAsk(scraped: readonly { label: string }[], questions: readonly AskQuestion[]): AskQuestion | null`.

**Why a ratio cannot work.** `parseDialog` folds the TUI's own rows into the same
numbered run, and their shape differs by layout: one-column numbers them
(`ask-user-question-real.txt:30` is `4. Type something.` and `:32` is
`5. Chat about this` — for a **three**-option ask), two-column leaves
`Chat about this` unnumbered and `dialog.ts:151-160` appends it anyway. So the
scraped row count is 5 or 3 for the same question, and nothing marks which rows
are the TUI's. There is no denominator. And 297 of 1039 real questions have
exactly two options, where "half matching" means one coincidental label.

So: head-anchored, pairwise, over `n = ask.options.length`; ignore every scraped
row past `n`; all must match at `n ≤ 3`, at most one mismatch at `n ≥ 4`; exactly
one question may align.

- [ ] **Step 1: Write the failing test**

```ts
describe('alignAsk', () => {
  const q = (question: string, ...labels: string[]): AskQuestion =>
    ({ question, multiSelect: false, options: labels.map((label) => ({ label })) });
  const rows = (...labels: string[]) => labels.map((label) => ({ label }));

  it('matches head-anchored and ignores the TUI’s own trailing rows', () => {
    // A 3-option ask scrapes as 5 rows in one-column layout.
    const picked = alignAsk(
      rows('Red', 'Green', 'Blue', 'Type something.', 'Chat about this'),
      [q('Which colour?', 'Red', 'Green', 'Blue')],
    );
    expect(picked?.question).toBe('Which colour?');
  });

  it('matches when the pane truncated a long label', () => {
    // leftCol cuts at a run of two spaces or the two-column gutter.
    const picked = alignAsk(
      rows('Stage-then-send + chips', 'Cosmetic only'),
      [q('How far?', 'Stage-then-send + chips (Recommended)', 'Cosmetic only')],
    );
    expect(picked?.question).toBe('How far?');
  });

  it('requires every position to match for a small question', () => {
    // Two options, one coincidental label — the old "half" rule accepted this.
    expect(alignAsk(rows('Red', 'Purple'), [q('Which colour?', 'Red', 'Green')])).toBeNull();
  });

  it('tolerates one mismatch only from four options up', () => {
    expect(alignAsk(rows('A', 'B', 'C', 'Z'), [q('Pick', 'A', 'B', 'C', 'D')])?.question).toBe('Pick');
    expect(alignAsk(rows('A', 'B', 'Z'), [q('Pick', 'A', 'B', 'C')])).toBeNull();
  });

  it('refuses when two questions align — there is no ordering signal', () => {
    // A multi-question call gets ONE tool_result, after the LAST answer, so all
    // of them look pending at once.
    expect(alignAsk(rows('Yes', 'No'), [q('First?', 'Yes', 'No'), q('Second?', 'Yes', 'No')]))
      .toBeNull();
  });

  it('returns null when nothing aligns', () => {
    expect(alignAsk(rows('Restart', 'Cancel'), [q('Which colour?', 'Red', 'Green')])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ask.test.ts -t alignAsk` → FAIL.

- [ ] **Step 3: Implement**

```ts
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Either side may be the truncated one: `leftCol` cuts a scraped label at a run
 *  of two spaces or at the two-column gutter, so compare as prefixes. */
const pairMatches = (a: string, b: string): boolean => {
  const [x, y] = [norm(a), norm(b)];
  return x !== '' && y !== '' && (x.startsWith(y) || y.startsWith(x));
};

/**
 * Which of the pending questions the on-screen menu is showing, or null.
 *
 * Head-anchored: only the first `ask.options.length` scraped rows are considered.
 * Rows past that are the TUI's own — numbered in one-column layout
 * (`4. Type something.`), unnumbered-then-appended in two-column — and nothing in
 * Dialog.options marks them, which is why a "fraction of rows matched" rule has
 * no definable denominator.
 */
export function alignAsk(
  scraped: readonly { label: string }[],
  questions: readonly AskQuestion[],
): AskQuestion | null {
  const fits = questions.filter((q) => {
    const n = q.options.length;
    if (n === 0 || scraped.length < n) return false;
    let miss = 0;
    for (let i = 0; i < n; i++) {
      if (!pairMatches(scraped[i]!.label, q.options[i]!.label)) miss += 1;
    }
    // Two-option questions are 29% of the corpus; one coincidental label must
    // never be enough evidence.
    return n >= 4 ? miss <= 1 : miss === 0;
  });
  return fits.length === 1 ? fits[0]! : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/ask.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/transcript/ask.ts infra/ccrc/server/test/ask.test.ts
git commit -m "feat(ccrc): head-anchored alignment between a pane menu and its tool call"
```

---

## Task 4: Ship `ask` on the dialog frame

**Files:**
- Modify: `infra/ccrc/server/src/sessionws.ts`
- Test: `infra/ccrc/server/test/sessionws.test.ts`; new fixture `infra/ccrc/server/test/fixtures/transcript-ask-2col.jsonl`

**Interfaces:**
- Consumes: `readPendingAsk`, `alignAsk` (Tasks 2–3).
- Produces: `checkDialog(file: string | null)`; `Dialog.ask` populated on the wire.

`checkDialog()` currently takes no arguments (`sessionws.ts:86`) and the class
stores only `uuid` (`:33`) — `file` is a local of `resolve()`, recomputed each tick
(`:152`). Pass it in: `r?.file ?? null` from the `start()` call at `:75` (where
`resolve()` may have returned null — send the dialog, skip the ask) and `r.file`
from `:209`. Which file matters: after an account swap the same `uuid.jsonl` exists
under several wrapper config dirs, and the ask must come from the one being tailed.

**Latch the enrichment.** The send gate is `lastDialogId !== dialog.id` (`:91`). If
the first poll that sees the menu fails to read the ask, the bare dialog goes out,
`lastDialogId` is set, and every later poll that *does* find it is suppressed
permanently. A two-way key fixes the miss but flaps — a flaky read then alternates
enriched and bare frames every 2 s, stripping descriptions off a sheet mid-read.
So: keep `lastAsk`, reset it when `dialog.id` changes, send on a new id **or** on
the upgrade, and never downgrade.

- [ ] **Step 1: Write the failing test**

```ts
describe('dialog enrichment', () => {
  it('carries the structured ask when the pane and transcript agree', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcript: fixture('transcript-ask-2col.jsonl'),
    });
    const d = frames.find((f) => f.type === 'dialog')!.dialog;
    expect(d.ask?.question).toContain('partial-capture hazard');
    expect(d.ask?.options[0]!.description).toBeTruthy();
    expect(d.ask?.options[0]!.preview).toContain('07-01');
    // Enrichment must not disturb the answer path.
    expect(d.options).toHaveLength(4);            // 3 numbered + "Chat about this"
    expect(d.options[3]!.label).toBe('Chat about this');
  });

  it('sends the same dialog id with and without ask', async () => {
    const withAsk = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'), transcript: fixture('transcript-ask-2col.jsonl'),
    });
    const without = await streamWith({ pane: fixture('ask-2col-chat-about.txt'), transcript: null });
    expect(withAsk.frames[0]!.dialog.id).toBe(without.frames[0]!.dialog.id);
  });

  it('delivers an ask that only becomes readable on a later poll', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcriptSequence: [null, fixture('transcript-ask-2col.jsonl')],
    });
    const dialogs = frames.filter((f) => f.type === 'dialog');
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]!.dialog.ask).toBeUndefined();
    expect(dialogs[1]!.dialog.ask).toBeDefined();
  });

  it('does not resend a bare dialog when a later ask read fails', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcriptSequence: [fixture('transcript-ask-2col.jsonl'), null, null],
    });
    expect(frames.filter((f) => f.type === 'dialog')).toHaveLength(1);
  });

  it('leaves a /model-style confirm unenriched', async () => {
    const { frames } = await streamWith({
      pane: fixture('model-confirm.txt'), transcript: fixture('transcript-ask-2col.jsonl'),
    });
    expect(frames.find((f) => f.type === 'dialog')!.dialog.ask).toBeUndefined();
  });
});
```

- [ ] **Step 2: Create the transcript fixture**

`server/test/fixtures/transcript-ask-2col.jsonl` — one `assistant` line whose
`tool_use` is `AskUserQuestion`, matching `ask-2col-chat-about.txt`'s three rows.
No new *pane* fixture is needed: that one is already a live capture, documented at
`dialog.test.ts:128-130`.

**The labels must be LONGER than the pane's rows, not equal to them.** Those three
labels round-trip out of the pane in full, so a fixture reusing the exact strings
passes under strict equality and never exercises the prefix rule. Use:

- `Forward-fill per class (Recommended)` — pane shows `Forward-fill per class`
- `Require completeness, Anthropic only` — pane wraps it
- `Ship as-is, alert + runbook`

Give option 1 a `description` and the `preview` from the pane's right-hand box (so
`toContain('07-01')` holds).

- [ ] **Step 3: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/sessionws.test.ts -t "dialog enrichment"` → FAIL.

- [ ] **Step 4: Implement**

In `sessionws.ts`, add fields and rework `checkDialog`:

```ts
  private lastAsk: AskQuestion | null = null;

  /** Capture the pane; send `dialog` when a menu appears/changes, and again the
   *  first time a structured ask becomes readable for it. Never the other way
   *  round: a transient transcript read failure must not strip descriptions off
   *  a sheet the operator is already reading. */
  private async checkDialog(file: string | null): Promise<void> {
    const pane = await this.deps.tmux.capture(this.id);
    const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
    if (!dialog) {
      if (this.lastDialogId !== null) {
        this.lastDialogId = null;
        this.lastAsk = null;
        this.send({ type: 'dialog_cleared' });
      }
      return;
    }

    const isNew = this.lastDialogId !== dialog.id;
    if (isNew) this.lastAsk = null;

    let ask = this.lastAsk;
    if (dialog.parsed && file !== null && ask === null) {
      const questions = await readPendingAsk(this.deps.io, file);
      ask = questions === null ? null : alignAsk(dialog.options, questions);
    }
    const upgraded = ask !== null && this.lastAsk === null;
    if (!isNew && !upgraded) return;

    this.lastDialogId = dialog.id;
    this.lastAsk = ask;
    // `id` stays purely pane-derived — answerDialog re-parses the pane to check
    // staleness, and the PWA keys dismissedId/answering off it.
    this.send({ type: 'dialog', dialog: ask === null ? dialog : { ...dialog, ask } });
  }
```

Update both call sites: `:75` → `await this.checkDialog(r?.file ?? null);`, `:209`
→ `await this.checkDialog(r.file);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run` → all pass.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/src/sessionws.ts infra/ccrc/server/test/sessionws.test.ts \
        infra/ccrc/server/test/fixtures/transcript-ask-2col.jsonl
git commit -m "feat(ccrc): enrich the dialog frame with the real question"
```

---

## Task 5: Sheet accepts a rich eyebrow

**Files:**
- Modify: `infra/ccrc/pwa/src/components/Sheet.tsx`
- Test: `infra/ccrc/pwa/test/primitives.test.tsx`

**Interfaces:**
- Produces: `SheetProps.eyebrow?: ReactNode` (widened from `string`).

The header chip cannot be passed today: `eyebrow?: string` (`Sheet.tsx:16`) renders
as `<p className="sheet-eyebrow">{eyebrow}</p>` (`:39`). Widening is purely
additive — all seven existing call sites pass strings and keep compiling.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts an element eyebrow, not just a string', () => {
  render(
    <Sheet open onClose={() => {}} title="t"
           eyebrow={<>claude is asking <span className="dlg-header-chip">Colour</span></>}>
      body
    </Sheet>,
  );
  expect(screen.getByText('Colour')).toHaveClass('dlg-header-chip');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/primitives.test.tsx` → FAIL (type error / no chip).

- [ ] **Step 3: Implement**

```ts
  /** Mono uppercase kicker above the title, e.g. "claude is asking". Accepts an
   *  element so callers can hang a chip off it (DialogSheet's header badge). */
  eyebrow?: ReactNode;
```
and tighten the render guard, since `ReactNode` admits null:

```tsx
          {eyebrow ? <p className="sheet-eyebrow">{eyebrow}</p> : null}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/components/Sheet.tsx infra/ccrc/pwa/test/primitives.test.tsx
git commit -m "feat(ccrc): sheet eyebrow takes a node"
```

---

## Task 6: Render the real question

**Files:**
- Modify: `infra/ccrc/pwa/src/session/DialogSheet.tsx`, `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/dialog-sheet.test.tsx`

**Interfaces:**
- Consumes: `Dialog.ask` (Task 1), `Sheet` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
const ASKED: Dialog = {
  id: 'd1', title: 'Forward-fill per class', parsed: true, selectedIndex: 1, raw: 'RAW PANE',
  options: [
    { index: 1, label: 'Forward-fill per class' },
    { index: 2, label: 'Require completeness, Anthropic only' },
    { index: 3, label: 'Ship as-is, alert + runbook' },
    { index: 4, label: 'Chat about this' },
  ],
  ask: {
    question: 'How should the partial-capture hazard be handled?',
    header: 'Revised fix', multiSelect: false,
    options: [
      { label: 'Forward-fill per class (Recommended)', description: 'Inherit the last seen rate.', preview: '07-01: in,out,cr' },
      { label: 'Require completeness, Anthropic only', description: 'Emit only complete rows.' },
      { label: 'Ship as-is, alert + runbook', description: 'Change nothing; watch it.' },
    ],
  },
};

it('shows the real question, the header chip and every description', () => {
  renderSheet(ASKED);
  expect(screen.getByText('How should the partial-capture hazard be handled?')).toBeInTheDocument();
  expect(screen.getByText('Revised fix')).toBeInTheDocument();
  expect(screen.getByText('Inherit the last seen rate.')).toBeInTheDocument();
  expect(screen.getByText('Emit only complete rows.')).toBeInTheDocument();
});

it('opens the preselected option’s preview and leaves the others collapsed', () => {
  renderSheet(ASKED);
  expect(screen.getByText('07-01: in,out,cr')).toBeVisible();
  expect(screen.getAllByRole('button', { name: /preview/i })).toHaveLength(1);
});

it('enriches by position and leaves the TUI’s own row alone', () => {
  renderSheet(ASKED);
  // Row 4 has no counterpart in ask.options — it keeps its scraped label.
  expect(screen.getByText('Chat about this')).toBeInTheDocument();
});

it('renders exactly as before when there is no ask', () => {
  renderSheet({ ...ASKED, ask: undefined });
  expect(screen.getByText('Forward-fill per class')).toBeInTheDocument();
  expect(screen.queryByText('Revised fix')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/dialog-sheet.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

In `DialogSheet.tsx`:

```tsx
  const ask = shown.ask;
  const eyebrow = ask?.header
    ? <>claude is asking <span className="dlg-header-chip">{ask.header}</span></>
    : 'claude is asking';
```

Pass `title={ask?.question ?? shown.title}`, and drop the scraped `body` when
`ask` is present (it is a lossy copy of the question). In the option map, take the
enrichment by position and render it:

```tsx
          const rich = ask?.options[o.index - 1];
          const label = rich?.label ?? o.label;
          const description = rich?.description ?? o.description;
```
```tsx
              <span className="opt-body">
                <span className="opt-label">{label}</span>
                {description && <span className="opt-desc">{description}</span>}
              </span>
```

and, after each row, the preview well — open by default on the preselected row:

```tsx
          {rich?.preview && (
            <OptionPreview text={rich.preview} defaultOpen={selected} />
          )}
```

```tsx
/** Fixed-width ASCII: it scrolls, it never wraps — the same rule code blocks
 *  follow. Capped at --well-max with internal scroll. */
function OptionPreview({ text, defaultOpen }: { text: string; defaultOpen: boolean }): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="opt-preview-wrap">
      <button type="button" className="opt-preview-toggle" aria-expanded={open}
              onClick={() => setOpen((o) => !o)}>
        {open ? '▾ preview' : '▸ preview'}
      </button>
      {open && <pre className="well opt-preview">{text}</pre>}
    </div>
  );
}
```

Move the "Show full question" toggle below the reply form when `ask` is present.

CSS:

```css
.dlg-header-chip {
  margin-left: var(--sp-2);
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--accent-tint);
  color: var(--accent);
  font: var(--weight-medium) var(--text-2xs) / 1.4 var(--font-mono);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}
.opt-desc {
  display: block;
  margin-top: 2px;
  color: var(--ink-secondary);
  font: var(--weight-regular) var(--text-sm) / var(--leading-normal) var(--font-ui);
  white-space: pre-wrap;
}
.opt-preview-toggle {
  border: 0; background: none; padding: var(--sp-1) 0;
  color: var(--accent);
  font: var(--weight-medium) var(--text-2xs) / 1 var(--font-mono);
  cursor: pointer;
}
.opt-preview {
  max-height: var(--well-max);
  overflow: auto;
  white-space: pre;               /* ASCII art scrolls; it must not reflow */
  font: var(--weight-regular) var(--text-2xs) / var(--leading-mono) var(--font-mono);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.
Run: `cd infra/ccrc/pwa && node design/contrast-check.mjs` → `ALL 74 PASS`.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/session/DialogSheet.tsx infra/ccrc/pwa/src/session/chat.css \
        infra/ccrc/pwa/test/dialog-sheet.test.tsx
git commit -m "feat(ccrc): the dialog sheet shows the question, not just the labels"
```

---

## Task 7: An ask reads as an ask in the transcript

**Files:**
- Modify: `infra/ccrc/pwa/src/session/ToolCard.tsx`, `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/chat.test.tsx`

**Interfaces:**
- Consumes: the existing `tool_use` / `tool_result` chat events.

Today an `AskUserQuestion` shows twice: once as the sheet, once in the chat as a
`ToolCard` whose summary is the first line of raw JSON (`ToolCard.tsx:47`).

- [ ] **Step 1: Write the failing test**

```ts
const ASK_USE = {
  kind: 'tool_use', uuid: 'a1', ts: NOW, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: [{ question: 'Which colour?', header: 'Colour',
    multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }] }] }),
} as const;

it('shows an asked question as a question, not as JSON', () => {
  render(<ChatListInner id="s" pending={[]} events={[ASK_USE]} />);
  expect(screen.getByText('Which colour?')).toBeInTheDocument();
  expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();
});

it('shows the answer once it lands', () => {
  render(<ChatListInner id="s" pending={[]} events={[ASK_USE, {
    kind: 'tool_result', ts: NOW, toolId: 't1',
    text: 'Your questions have been answered: "Which colour?"="Green"', isError: false,
  }]} />);
  expect(screen.getByText(/Green/)).toBeInTheDocument();
});

it('falls back to the generic row when the input was truncated', () => {
  render(<ChatListInner id="s" pending={[]} events={[{ ...ASK_USE, input: '{"questions":[{"que' }]} />);
  expect(screen.getByText('AskUserQuestion')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/chat.test.tsx -t "asked question"` → FAIL.

- [ ] **Step 3: Implement**

In `ToolCard.tsx`, before the generic render:

```tsx
/** The first question's text, or null if the input is unusable — it is capped at
 *  TOOL_INPUT_MAX upstream, so a big ask arrives truncated and unparseable. */
function askSummary(input: string): string | null {
  try {
    const q = (JSON.parse(input) as { questions?: { question?: unknown }[] }).questions?.[0];
    return typeof q?.question === 'string' ? q.question : null;
  } catch {
    return null;
  }
}
```
```tsx
  if (use.name === 'AskUserQuestion') {
    const question = askSummary(use.input);
    if (question !== null) {
      return (
        <div className="tool-ask">
          <span className="tool-ask-glyph" aria-hidden="true">❓</span>
          <span className="tool-ask-q">{question}</span>
          {result && <span className="tool-ask-a">{answerOf(result.text)}</span>}
        </div>
      );
    }
  }
```

with `answerOf` pulling the chosen label out of the result's
`Your questions have been answered: "…"="…"` text, falling back to the raw text.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/session/ToolCard.tsx infra/ccrc/pwa/src/session/chat.css \
        infra/ccrc/pwa/test/chat.test.tsx
git commit -m "feat(ccrc): an asked question reads as one in the transcript"
```

---

## Task 8: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Every suite, build, gates**

```bash
(cd infra/ccrc/server && npx vitest run && npx tsc --noEmit)
(cd infra/ccrc/agent  && npx vitest run && npx tsc --noEmit)
(cd infra/ccrc/pwa    && npx vitest run && npm run build && node design/contrast-check.mjs)
```
Expected: all green, `ALL 74 PASS`, counts ≥ baseline.

- [ ] **Step 2: Manual check against a live session**

Deploy, then have a session ask a question **with previews** (this plan's own specs
make good material). In the PWA confirm: the real question as the title, the header
chip, every description on its row, the preselected preview open and horizontally
scrollable, `Chat about this` still present and still answering correctly. Then
answer from the PWA and confirm the session advances.

- [ ] **Step 3: Check the degraded paths by hand**

- `/model` → the sheet renders as it does today, no chip, no descriptions.
- Answer a question from the **terminal** while the sheet is open → the sheet
  closes on `dialog_cleared`; no stale enrichment survives.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u && git commit -m "test(ccrc): full-stack verification for structured questions"
```
