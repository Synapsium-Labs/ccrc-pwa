# Session continuity, wave 4c — the direct-kill scanner reads the notifications it missed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** Drafted 2026-11-04 from the operator's ruling of that day (programme ledger, Decisions, 2026-11-04 10:22) at base `6da86bb8323e1c949a3e27e2cbd82606f475b121`. Approved as written by the operator on 2026-11-04 at 15:11 UTC (item 30). It is dispatched as one worker run once it lands; the run is recorded in the programme ledger.

**Goal:** Make `deploy/measure-continuity.py --stage 6`'s `direct_pressure_kills` read the task notifications it now misses: those delivered as queued-command attachments, those only enqueued, and the summary-only notices it now counts as unmeasured. Neither the kill rule nor the B + 2 comparison changes.

**Architecture:** One adapter, `s6_notification_sources(row)`, yields `(source, text)` pairs from three row shapes: today's user text rows, `queued_command` attachment prompts, and `queue-operation` enqueue contents. Every pair goes through the scanner's existing per-envelope classification, which gains one known-non-event arm for a summary-only notice that does not name low memory. Kills stay unique per (transcript uuid, task id). An unmeasured notification is now counted once per (transcript uuid, envelope text), so one notice seen in several rows counts once. An additive `notification_sources` field makes each source's coverage visible.

**Tech Stack:** Python 3 standard library only (the tool runs under `python3 -I`), and the Vitest suites in `server/` that run the tool against fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §9, its table row for stage 6 and its "As built (wave 4b)" note, which declares what the scanner does not read. The ruling, and the measured scope below, are in `docs/superpowers/programs/session-continuity.md` (Decisions, 2026-11-04 10:22). The wave 4b plan `docs/superpowers/plans/2026-10-13-session-continuity-wave4b-pressure-reap-and-clear.md` (Task 4, and D-4322's non-event shapes) is the scanner's origin; read its Task 4 first.

## What was measured, and what this wave changes

Measured read-only on the fleet box over the two post-deploy weeks (2026-10-21 05:38 to 2026-11-04 05:38 UTC), by reusing the installed scanner's own functions and printing counts only:

| Where notifications sit | Two weeks | Read today | This wave |
|---|---|---|---|
| user text rows (`type: user`, text content) | every delivered-at-idle notice | yes | unchanged |
| `queued_command` attachment rows (`type: attachment`, `attachment.type: queued_command`, `attachment.prompt`) | about 1,100 to 1,450 a week, 22 of them `killed` with a non-pressure summary | no | read (D-7960) |
| `queue-operation` enqueue rows (`operation: enqueue`, `content`) | about 4,800 to 5,000 a week, mostly the same notices again | no | read, deduplicated (D-7960, D-7961) |
| `queue-operation` remove and dequeue rows | about 2,000 a week; a dequeue has no content | no | not read: the same text as the enqueue |
| summary-only envelopes (one `summary` element, nothing else) in user rows | 43 re-read today, 9 in week 1 and 34 in week 2 (week 2's own reading showed 33 unmeasured in all), all Claude Code's commit, push and background security-review notices; re-read today they are every unmeasured notification of both weeks | counted unmeasured | a known non-event unless it names low memory (D-7962) |
| subagent transcripts (`projects/*/<uuid>/subagents/*.jsonl`) | 2,682 files, no notification in the window | no | stays outside, declared (D-7963) |

No source held a pressure kill in either week. This wave makes that reading complete where it is now partial; it does not change what counts as a kill.

## Global Constraints

- Public repository: fixtures use the suite's neutral names (`U1`, `U2`, `-project-a`) and fixture HOMEs from `makeCcdHarness`. Nothing reads live transcripts in a test.
- The instrument stays read-only and standard-library only under `python3 -I`: no write, no network, no new dependency.
- The kill rule is unchanged for every source. A kill is a strict `<task-notification>` envelope with nothing after its closing tag, exactly one readable `<task-id>`, exactly one readable `<status>killed</status>`, and exactly one readable `<summary>` that fullmatches `S6_PRESSURE_SUMMARY`.
- `reap_class_oom`, `pressure_reap_comparison` and `inert_scopes` are untouched. The direct count never feeds the B + 2 comparison.
- Output is additive. Every existing `direct_pressure_kills` field keeps its name. `unmeasured_notifications` keeps its name, and D-7961 changes only what one unit of it is. `reading` is still `partial` whenever anything is unreadable, malformed or unmeasured, and `absent` still means no transcripts.
- `transcripts(ctx)`, the stage-1 discovery that other stages share, is not changed.
- Every test runs from `server/` as `"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>.test.ts`, in the foreground, with a Bash timeout of at least 600000 ms. `typecheck-tests` runs alone.
- Each new guard ships with a mutation row, measured red when the guard is deleted and green when it is restored from a saved copy (sha256 and mode checked), never by `git checkout`.
- `README.md` may be under another run's claim when Task 3 starts: read `GET /api/claims?project=ccrc-pwa` and claim it, or ask its holder for consent through the coordinator, before the edit.

## Review Focus

| Input or failure class | Expected behaviour, and the test that pins it |
|---|---|
| One notice delivered as a queued-command attachment AND later as a user row, or enqueued AND delivered | One kill per (uuid, task id), one unmeasured count per (uuid, text): Task 1 `one notification across sources is counted once` |
| A queued payload that holds a notification but is not a string or text parts | Unmeasured, so the reading turns partial, never a silent skip: Task 1 `a queued payload the scanner cannot read is unmeasured, never skipped` |
| A notice enqueued just before a window's end and delivered just after it | Each row is timed by its own stamp, so it counts in both windows, an over-count by design: Task 1 `a notice enqueued before the window edge and delivered after it counts in both windows` |
| A summary-only notice that names low memory, in its summary or in free text beside it | Unmeasured, never a non-event: Task 2 `a summary-only notice that names low memory stays unmeasured` and its free-text case |
| A file that fails part-way through its read | Its kills, unmeasured texts and source counts are all dropped together: Task 1, the two torn-read cases |

---

### Task 1: Read the queued sources, and count each notification once

**Files:**
- Modify: `deploy/measure-continuity.py` (`s6_notification_texts`, `s6_pressure_kills`, and the stage-6 header comment beside `S6_NOTE`)
- Test: `server/test/measure-continuity-pressure-kills.test.ts`

**Interfaces:**
- Produces: `s6_notification_sources(row) -> list[tuple[str, str, bool]]`, yielding `(source, text, readable)`. `source` is one of `"user"`, `"queued_command"` or `"queue_enqueue"`.
  - `"user"`: each text `s6_notification_texts(row)` returns today, readable.
  - `"queued_command"`: when `row["type"] == "attachment"`, `row["attachment"]` is a dict and its `type` is `"queued_command"`. A `prompt` that is a str yields one readable text. A `prompt` that is a list yields each `{"type": "text", "text": <str>}` part, readable, the way the user arm reads list content. Any other element of that list whose `json.dumps(element, sort_keys=True)` contains `<task-notification>` yields one unreadable item.
  - `"queue_enqueue"`: when `row["type"] == "queue-operation"` and `row["operation"] == "enqueue"`. A `content` that is a str yields one readable text.
  - Any other `prompt` or `content` in those two rows yields one unreadable item when `json.dumps(value, sort_keys=True)` contains `<task-notification>`. The text is that dump and `readable` is False; with no notification in it, the row yields `[]`.
  - Every other row yields `[]`: an attachment of another type, a dequeue, a remove.
- An unreadable item is one unmeasured notification, keyed by its `(uuid, text)` like any other.
- Produces: `direct_pressure_kills.notification_sources: {"user": int, "queued_command": int, "queue_enqueue": int}`.
  - It counts, per source and before deduplication, the readable texts that start with `<task-notification>` and the unreadable items.
  - It counts only rows that pass the stamp-type check and the window. A row whose `timestamp` is present but not a string is one malformed row and is not counted. An undated row (no timestamp, or one `iso_epoch` cannot read) is not excluded by the window, as today.
  - It is present on every reading except `{"transcripts": "absent"}`.
- Admission per file, unchanged in kind: a file's kills, unmeasured keys and source counts are kept only once the file reads to its end. A read that fails part-way drops all three for that file.
- Time base: each text is timed by its own row's stamp. A delivered notice is timed at delivery, as today; an enqueued one at its queue time. A notice enqueued before `--until` and delivered after it counts in both adjacent windows, an over-count by design and the safe direction for a target of 0. For every row the order is the code's own: the stamp-type check (a non-string stamp makes the row malformed, and nothing in it is counted), then the window, then the source count, then the envelope classification.

- [ ] **Step 1: Add the fixture helpers and split `read()`.**

```ts
type Sources = { user: number; queued_command: number; queue_enqueue: number };
const src = (user: number, queued_command = 0, queue_enqueue = 0): Sources => ({ user, queued_command, queue_enqueue });
const attachmentRow = (prompt: unknown, t: number = T): string => JSON.stringify({
  type: 'attachment', timestamp: iso(t), attachment: { type: 'queued_command', prompt, commandMode: 'prompt' } });
const queueRow = (content: unknown, operation = 'enqueue', t: number = T): string => JSON.stringify({
  type: 'queue-operation', operation, timestamp: iso(t), ...(content === null ? {} : { content }) });
// readFull(extra) is today's read() body, returning the whole section, notification_sources included.
// read(extra) calls readFull, asserts that notification_sources is three non-negative integers on every
// reading except { transcripts: 'absent' }, and returns the rest, so the existing read() assertions stay as they are.
// readTorn is unchanged; its two tests now expect the field (Step 2).
```

- [ ] **Step 2: Write the failing tests, and the torn-read expectations.**

```ts
it('a kill delivered only as a queued-command attachment is counted', () => {
  transcript(U1, [attachmentRow(note('q1'))]);
  expect(readFull()).toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 1, 0) });
});
it('a kill seen only in a queue enqueue row is counted', () => {
  transcript(U1, [queueRow(note('e1'))]);
  expect(readFull()).toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 0, 1) });
});
it('one notification across sources is counted once', () => {
  const odd = note('odd', 'exploded');
  transcript(U1, [queueRow(note('k')), attachmentRow(note('k')), row(note('k')),
    queueRow(odd), attachmentRow(odd), row(odd)]);
  expect(readFull()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unmeasured_notifications: 1,
    notification_sources: src(2, 2, 2) });
});
it('dequeue and remove rows are not read', () => {
  transcript(U1, [queueRow(note('r'), 'remove'), queueRow(null, 'dequeue')]);
  expect(readFull()).toEqual({ ...clean(0, 0, 1), notification_sources: src(0) });
});
it('an attachment of another type is not a notification', () => {
  transcript(U1, [JSON.stringify({ type: 'attachment', timestamp: iso(T),
    attachment: { type: 'skill_listing', prompt: note('s') } })]);
  expect(readFull()).toEqual({ ...clean(0, 0, 1), notification_sources: src(0) });
});
it('a queued-command prompt in text parts is read as the user arm reads list content', () => {
  transcript(U1, [attachmentRow([{ type: 'text', text: note('p') }])]);
  expect(readFull()).toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 1, 0) });
});
it('a queued payload the scanner cannot read is unmeasured, never skipped', () => {
  transcript(U1, [attachmentRow({ text: note('o1') }), queueRow({ text: note('o2') }), queueRow({ text: 'no notice' }),
    attachmentRow([note('a')]), attachmentRow([{ type: 'image', source: 'x' }])]);
  expect(readFull()).toEqual({ ...clean(0, 0, 1), reading: 'partial', unmeasured_notifications: 3,
    notification_sources: src(0, 2, 1) });
});
it('a queued row with a non-string timestamp is one malformed row', () => {
  transcript(U1, [JSON.stringify({ type: 'attachment', timestamp: 1760443200,
    attachment: { type: 'queued_command', prompt: note('t') } }), row(note('real'))]);
  expect(readFull()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1,
    notification_sources: src(1) });
});
it('the window applies to queued rows by their own timestamp', () => {
  transcript(U1, [attachmentRow(note('early'), T - 1), queueRow(note('late'), 'enqueue', T + 86400),
    attachmentRow(note('in'), T + 1)]);
  expect(readFull(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00']))
    .toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 1, 0) });
});
it('a notice enqueued before the window edge and delivered after it counts in both windows', () => {
  transcript(U1, [queueRow(note('edge'), 'enqueue', T - 1), attachmentRow(note('edge'), T + 1)]);
  expect(readFull(['--since', '2026-10-13 12:00:00', '--until', '2026-10-14 12:00:00']))
    .toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 0, 1) });
  expect(readFull(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00']))
    .toEqual({ ...clean(1, 1, 1), notification_sources: src(0, 1, 0) });
});
// The two torn-read cases now expect the field; the torn file admits none of its rows:
//   readTorn(U1, 2)  -> { ...clean(1, 1, 1), reading: 'partial', unreadable_transcripts: 1, notification_sources: src(1) }
//   readTorn(U1, 99) -> { ...clean(3, 2, 2), notification_sources: src(3) }
```

- [ ] **Step 3: Run the file, and confirm what fails.**

Run: `"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/measure-continuity-pressure-kills.test.ts`
Expected: FAIL.
- All ten new cases fail, because each asserts `notification_sources` and the base never emits it.
- Every existing `read()` case except the absent one fails `read()`'s new shape check.
- Both torn cases fail on their newly expected field.

- [ ] **Step 4: Implement `s6_notification_sources` and use it in `s6_pressure_kills`.**

Iterate `for source, text, readable in s6_notification_sources(row)` where the loop now iterates `s6_notification_texts(row)`. Keep the stamp-type check first and per row, so a row with a non-string stamp is one malformed row whatever its source and adds no source count. Count the source after the window check. An unreadable item adds its key to the unmeasured set without classification. Replace `file_unmeasured += 1` with adding `(uuid, text)` to a per-file unmeasured set, and keep a per-file source counter. Union both into the reading's totals only after the file reads to its end, as `file_hits` is today; `unmeasured_notifications` is the size of the union.

In the stage-6 header comment, rewrite three things:
- the "complete user-message `<task-notification>` envelope" sentence, to name the three sources;
- the "timed by the notification's delivery stamp" sentence, to state each source's time base and the cross-window over-count;
- the "Declared discovery limits" sentence, to name the rows not read (remove and dequeue), the unreadable-payload rule and D-7961's unit.

- [ ] **Step 5: Run the file again, and the other stage-6 suites.**

Run the pressure-kills file, then `test/measure-continuity-stage6.test.ts` and `test/measure-continuity.test.ts`, each in its own process.
Expected: PASS, all three.

- [ ] **Step 6: Measure the mutation rows, one at a time.**

| Row | Mutation | Expected red |
|---|---|---|
| 4C-SRC-ATT | the `queued_command` arm returns `[]` | `a kill delivered only as a queued-command attachment is counted` |
| 4C-SRC-ENQ | the `queue_enqueue` arm returns `[]` | `a kill seen only in a queue enqueue row is counted` |
| 4C-NO-REMOVE | the enqueue arm accepts any `operation` | `dequeue and remove rows are not read` |
| 4C-DEDUPE-UNM | unmeasured counted per row again | `one notification across sources is counted once` |
| 4C-ATT-TYPE | the attachment arm ignores `attachment.type` | `an attachment of another type is not a notification` |
| 4C-ATT-LIST | a list `prompt` yields `[]` | `a queued-command prompt in text parts is read …` |
| 4C-QUEUED-UNREADABLE | an unreadable payload yields `[]` | `a queued payload the scanner cannot read is unmeasured, never skipped` |
| 4C-LIST-UNREADABLE | a list element that is not a text part yields `[]` | the same case (unmeasured 2, not 3) |
| 4C-TORN-SOURCES | source counts added as rows are read, not at the file's end | `hits from a file are admitted only after it reads to its end …` |

- [ ] **Step 7: Commit.**

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-pressure-kills.test.ts
git commit -m "feat(measure): the direct-kill scanner reads queued-command and enqueued notifications, counting each once (D-7960, D-7961, D-7963)"
```

### Task 2: A summary-only notice that does not name low memory is a known non-event

**Files:**
- Modify: `deploy/measure-continuity.py` (`s6_pressure_kills`'s no-status arm, and the header comment's list of known non-event shapes)
- Test: `server/test/measure-continuity-pressure-kills.test.ts`

**Interfaces:**
- Consumes: Task 1's loop, and its `readFull`, `src` and `attachmentRow` helpers.
- Produces: `S6_SUMMARY_ONLY = re.compile(r"<summary>([^<>]*)</summary>")`.
  - The new arm runs where `status_openers == 0` now falls through to unmeasured.
  - It calls `S6_SUMMARY_ONLY.fullmatch(body)` on the envelope body, which the envelope match has already stripped of surrounding whitespace. So the summary must be the whole body: no other element, no closing tag of another element, and no free text.
  - It is a known non-event only when the whole body is that one summary and its value contains no `low on memory`, case-insensitively.
  - Anything else in the no-status arm stays unmeasured, exactly as at the base.
- It keeps the trailing-reminder tolerance of the other known non-event shapes: whole trailing `<system-reminder>` blocks after the closing tag.

- [ ] **Step 1: Write the failing tests.**

```ts
const summaryOnly = (s: string): string => `<task-notification>\n<summary>${escapeText(s)}</summary>\n</task-notification>`;
it('a summary-only security-review notice is a known non-event', () => {
  transcript(U1, [row(summaryOnly('Commit security review found 2 issues in <file>')),
    attachmentRow(summaryOnly('Push security review did not finish'))]);
  expect(readFull()).toEqual({ ...clean(0, 0, 1), notification_sources: src(1, 1, 0) });
});
it('with trailing reminder blocks a summary-only notice is still a known non-event', () => {
  transcript(U1, [row(`${summaryOnly('Background security review found: path handling')}\n${reminder()}`)]);
  expect(read()).toEqual(clean(0, 0, 1));
});
it('a summary-only notice that names low memory stays unmeasured', () => {
  transcript(U1, [row(summaryOnly(PRESSURE)), row(summaryOnly('the box is running LOW ON MEMORY'))]);
  expect(read()).toEqual({ ...clean(0, 0, 1), reading: 'partial', unmeasured_notifications: 2 });
});
it.each([
  ['free text after the summary that names low memory',
    summaryOnly('Commit security review found 1 issue').replace('</summary>', '</summary>\nBackground command "x" was stopped because the system is running low on memory')],
  ['a stray closing tag', summaryOnly('Commit security review found 1 issue').replace('</summary>', '</summary>\n</status>')],
  ['a second element', summaryOnly('Commit security review found 1 issue').replace('</summary>', '</summary>\n<note>x</note>')],
  ['two summaries', summaryOnly('one').replace('</summary>', '</summary>\n<summary>two</summary>')],
  ['a summary with an attribute', summaryOnly('one').replace('<summary>', '<summary kind="x">')],
])('a summary-only notice with anything else in its body stays unmeasured: %s', (_name, text) => {
  transcript(U1, [row(text)]);
  expect(read()).toEqual({ ...clean(0, 0, 1), reading: 'partial', unmeasured_notifications: 1 });
});
```

- [ ] **Step 2: Run them, and confirm what fails.** Run the pressure-kills file through `ccrc test`, as in Task 1. Expected: the two non-event cases fail, reading unmeasured; the five stays-unmeasured cases and the low-memory case pass.

- [ ] **Step 3: Implement the arm.** Rewrite the header comment's "A KNOWN NON-EVENT is …" list to add the summary-only shape, its whole-body rule and its low-memory exclusion.

- [ ] **Step 4: Run the file and the existing D-4322 cases.** Expected: PASS. `stays unmeasured: no event element and no status` and `stays unmeasured: no task id` still read unmeasured, because each body holds more than its one summary.

- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| 4C-SUMMARY-ONLY | delete the arm | `a summary-only security-review notice is a known non-event` |
| 4C-SUMMARY-PRESSURE | drop the low-memory exclusion | `a summary-only notice that names low memory stays unmeasured` |
| 4C-SUMMARY-ALONE | `S6_SUMMARY_ONLY.search(body)` instead of `fullmatch` | `… stays unmeasured: free text after the summary that names low memory` |

- [ ] **Step 6: Commit.**

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-pressure-kills.test.ts
git commit -m "feat(measure): a summary-only notice that does not name low memory is a known non-event (D-7962)"
```

### Task 3: Record the as-built reading in the spec and the README

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (§9: a new paragraph after "As built (wave 4b …)")
- Modify: `README.md` (the `deploy/measure-continuity.py --stage 6` paragraph)

**Interfaces:** none. Documentation only.

- [ ] **Step 1: Add the spec paragraph.** It begins "**As built (wave 4c, <merge date>; an as-built annotation, not a new ruling).**" and states:
  - the three sources read and the two not read, and the unreadable-payload rule;
  - each source's time base, and the cross-window over-count;
  - D-7961's unit;
  - the summary-only non-event and its low-memory exclusion;
  - that subagent transcripts stay outside;
  - that the kill rule, the B + 2 comparison and the 0 target are unchanged.
  The wave 4b paragraph is not edited.
- [ ] **Step 2: Update README's paragraph.** It now reads that discovery "excludes subagent transcripts and does not read notifications delivered mid-turn as queued-command attachment rows", and that "Notification times are observations at delivery". Make it name what is read now and what is not, and each source's time base.
- [ ] **Step 3: Run the document readers.** Run `anchors`, `citations`, `docs-parity`, `dtbd` and `deviation-refs` (after `git fetch origin main`), each in its own `ccrc test` process. Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-09-23-session-continuity-design.md README.md
git commit -m "docs(continuity): the direct-kill scanner's as-built sources (wave 4c)"
```

## Final gates

- [ ] `python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' deploy/measure-continuity.py`, then `git diff --check`.
- [ ] Each of `measure-continuity-pressure-kills`, `measure-continuity-stage6`, `measure-continuity`, `measure-continuity-stage4` and `measure-continuity-stage7` in its own `ccrc test` process. Then `typecheck-tests` alone, `topology-clean`, `dtbd` and `deviation-refs`.
- [ ] Scan every added line and commit message for private material with the repository's private-name scanner before the push.
- [ ] Open the PR with durable GitHub links to this plan and the spec. Wait for its fast run on the exact tip and read its selection; run any selected server file your list missed. Then send one wave-done at that tip, with its `suite:` and `failure:` lines, the mutation table and the commits.

## Deviations Found

The allocator issued D-7960 through D-7963 on 2026-11-04 10:17 UTC. All four are defined here, in the same publication act. New discoveries during execution are written `D-TBD-<slug>` and reported for coordinator allocation.

- **D-7960** — the direct-kill scanner reads two more sources, `queued_command` attachment prompts (a string, or text parts) and `queue-operation` enqueue contents, through the same classification. A queued payload of any other shape that holds a notification, a list element included, is unmeasured. Remove and dequeue rows are not read. Each row is timed by its own stamp, so a notice enqueued before a window's end and delivered after it counts in both windows, an over-count by design.
- **D-7961** — `unmeasured_notifications` counts each unmeasured envelope once per (transcript uuid, envelope text), across sources and copies, not once per row. Kills stay unique per (transcript uuid, task id).
- **D-7962** — an envelope whose whole body is one readable `summary`, with no other element, closing tag or text, is a known non-event when the summary does not contain "low on memory". One that does stays unmeasured.
- **D-7963** — `notification_sources` is an additive per-source count. Subagent transcripts stay outside the scanner's pattern: measured at 2,682 files with no notification in two weeks, they are a declared limit, not a read source.

## Where Things Stand

### Agreed

- The operator's ruling of 2026-11-04 is to redesign the scanner to read the notifications it now misses (programme ledger, Decisions, 2026-11-04 10:22).
- The kill rule, the B + 2 comparison and the target of 0 are unchanged.
- The operator approved this plan as written on 2026-11-04 at 15:11 UTC (item 30).

### Waiting on You

- Nothing. The coordinator lands this plan, then opens its run and dispatches it.

### Later

- Stat failures in transcript discovery, which is shared with stage 1, stay a declared limit.
- Weeks already read are not re-read under the new scanner. The weekly reading after this wave deploys is the first one that uses it.
