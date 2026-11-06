# Task M: one recogniser, one plugin (D-8060), worker's note

Task M of [the chat reading plan](../2026-11-06-chat-reading.md). This note records what the task measured and where it
departs from the plan's text, by slug, for the coordinator to fold into the plan's ledger. It defines no number.

## Step 0, measured on the base (6954765b6)

`markdown-golden.test.tsx`, `render-hast.test.tsx`, `markdown-parse.test.ts` and `markdown-purity.test.ts`: 4 files,
326 tests, all passed.

The corpus cases (`CHAT_CORPUS` and `RECAP_CASE`) whose text holds a bold lead-in, a status word in a label position,
or a list after an action lead-in: **none**. Read case by case:

| Case | What it holds | Why it is not one |
|---|---|---|
| `emphasis-runs` | a paragraph opening `**strong**` | "strong" is no action lead and does not end in `.` or `:` |
| `callout-emptied-lead`, `callouts-all-kinds` | bold inside callouts | lead-ins are marked at the top level only |
| `gfm-table` | `**b**` in a cell | "b" is no status word |
| `gfm-task-list` | "done task" | in a list item, not after a name or a subject |
| `recap-opened` | the cell `~~open~~ done` | the cell's first child is a strikethrough, not text |

After the plugin joined both paths, a scan of every corpus tree through the chat profile found no mark, status or
lead attribute at all. So the reviewed list of goldens to change is empty, and Step 4 rewrote nothing:
`markdown-golden.test.tsx` passed 173 of 173 under `CI=1`, every stored file byte-identical. Its header carries one line
saying so.

## Departures, by slug

- **`purity-roots-name-the-pair`.** The plan lists `markdown-purity.test.ts` as unchanged. Its case "is exactly the
  worker-side lib files and the shared byte counter" compares the closure with its `ROOTS` list, so the closure growing
  by `chatMarks.ts` and `remarkChatMarks.ts` reds it. The two names are added to `ROOTS`, in two lines. The rule the
  test holds, nothing outside the closure but the allowed packages, is unchanged and green.
- **`marks-cases-outside-the-golden-corpus`.** Step 3 adds "the corpus cases these use to `markdownCorpus.ts`". They
  are a separate export, `CHAT_MARKS_CASES`, not entries of `CHAT_CORPUS`. Every `CHAT_CORPUS` entry gets a golden
  file, and the goldens hold today's output, so new entries there would mean new golden files written by this task's
  own code. The parity cases (`render-hast.test.tsx`) and the profile cases (`markdown-parse.test.ts`) read them.
- **`item-case-insensitive`.** The plan's grammar says "case-insensitive" in the run clause and not in the item
  clause. `item N` is read case-insensitively and word-bounded too, so "Item 34" at the start of a sentence is a name,
  as "Run 1527" is.
- **`word-character-in-any-script`.** "Word character" is read as a letter, combining mark or digit of any script, or
  `_`. So a hex run straight after an accented letter (`café1234abc`) is no commit. A row in `chat-marks.test.ts` pins it.
- **`unmark-joins-text`.** The A16 amendment's `unmark` also joins adjacent text nodes, because the plugin splits one
  text node into several. An input in which chat marks nothing is still compared strictly, as before.
- **`chatmarkdown-parity-case`.** Beyond the plan's parity cases, one case holds `ChatMarkdown`, with
  `CHAT_REMARK_PLUGINS` itself, equal to the worker path. Without it the parity would check only the test's own copy of
  the list.
- **`mutant-5-shape`.** As worded ("the walk descends into `inlineCode`"), mutant 5 cannot change the output: an
  mdast `inlineCode` node has a value and no children. It is measured as the plugin reading an `inlineCode` value as
  text. Mutant 12 (below) adds the skip set losing `link`.

## Mutants

Each was written into the named file, run against the named test, and restored from a saved copy with its
sha256 checked. All 12 went red on the named case, and the tree was clean after each.

| # | Mutant | File | Red case |
|---|---|---|---|
| 1 | the PR grammar's word-before guard dropped | `chatMarks.ts` | `chat-marks` "C#1" |
| 2 | the commit grammar's digit-and-letter rule dropped | `chatMarks.ts` | "deadbeef", "1234567", "#1234567" |
| 3 | the `..` refusal dropped | `chatMarks.ts` | "docs/a/../b.md" |
| 4 | S3 allows two linkers | `chatMarks.ts` | "CI is now green (two linkers) is not" |
| 5 | the plugin reads an `inlineCode` value as text | `remarkChatMarks.ts` | `remark-chat-marks` "no mark inside inline code, a fence, a link, an autolink or an image" |
| 6 | lead-ins marked inside a blockquote | `remarkChatMarks.ts` | "a lead-in inside a callout or a quote is not marked" |
| 7 | the plugin added to the docs profile | `markdownParse.ts` | `markdown-parse` "the docs profile carries no chat mark" |
| 8 | the `span` arm drops status spans | `markdown.tsx` | `render-hast` "every tone, both lead-ins and the list after an action lead-in, not just equal", "a mark draws its text only" |
| 9 | a second `STATUS_WORDS` planted in `markdown.tsx` | `markdown.tsx` | `single-definition/chat-marks` "… declared in chatMarks.ts alone" |
| 10 | an action lead-in's list flag survives a paragraph between | `remarkChatMarks.ts` | "… and a list two blocks later is not" |
| 11 | the word class narrowed to ASCII | `chatMarks.ts` | "a letter of any script is a word character" |
| 12 | `link` dropped from the skip set | `remarkChatMarks.ts` | "no mark inside inline code, a fence, a link, …" |

## Gates

Run one at a time through `ccrc test`. The pwa type check (`tsc --noEmit`, which includes `test/`): clean. The whole
pwa suite, on its first full run after the implementation was complete: 466 files, 13 739 tests passed, 3 skipped.
`server/test/single-definition/`: 23 files, 1 084 tests passed. The tree-scanning guards (topology-clean, source-bytes,
deviation-refs, anchors, citations, dtbd, growth-check, ownership, rings): 19 files passed.

## Fix round 1 (review 1574)

The coordinator's rulings, applied red first inside this task's claims:

| Ruling | What changed | Pinned by |
|---|---|---|
| 1, F-A | A word character is read by whole code point (`wordBefore`, `wordAfter`), so a letter outside the BMP bounds a name, as `word-character-in-any-script` claims | rows `𠀀#1` and `#1𝐀` |
| 2, F-B | S2 marks a `strong` only when every child is a text node: a bold holding inline code or a link is not marked | "S2 does not mark a bold holding inline code or a link" |
| 3, F-C | none: the after-lead flag already ended at any block. A row and a mutant now hold it | "a list after an action lead-in with a heading / a fence / another list between is not marked" |
| 3, F-D | none: a commit already could not follow `.`, `/` or `-`. Rows and a mutant now hold it | rows `feat-4c677d328`, `v1.2.4c677d328`, `a/4c677d328` |
| 3, F-E | none: a document path already could not run on into `/` or `-`. Rows and a mutant now hold it | rows `docs/a.md/x`, `docs/a.md-bak` |
| 4, G2 | A commit is not followed by `-`, nor by `.` and a word character; a document path is not followed by `.` and a word character. A sentence-ending `.` still ends a name | rows for two UUIDs, `abc1234.ts` and `docs/plan.md.bak`; positives `at abc1234.` and `read docs/a.md.` |
| 4, G3 | A commit is never digits, one `e`, digits (`EXPONENT = /^\d*e\d+$/`): the smallest rule that refuses both `1e10000` and `e1234567`. A rule like "no digit-e-digit" alone would let `e1234567` through | rows `1e10000`, `10e1000`, `e1234567` |
| 4, colours | none needed: a PR takes digits only, and a commit is at least seven characters, so `#a3f`, `#1a2b3c` and `#ff00aa` were already text. Rows hold it; digits-only `#333` and `#000000` stay PR marks | three negative rows, two positive rows |
| 5, P4 | S1 reads body rows only; the header row keeps plain text | "S1 does not label a header cell" |

Left as observed, not ruled: an 8-digit colour such as `#ff00aa80` is still `#` followed by a commit mark, because the
ruling names 3 and 6 digits. Task L's repository rule decides whether it links.

### Mutants, fix round 1

All 12 earlier mutants were re-run with their anchors moved to the new code (mutant 1 is now the `wordBefore` skip
letting a `#` through, and mutant 2 drops the digit-and-letter test). Twelve new mutants were added. All 24 went red on
the named case, each restored from its saved copy with its sha256 checked.

| # | Mutant | Red case |
|---|---|---|
| 13a | `wordBefore` reads one UTF-16 unit | "an astral letter before (𠀀#1)" |
| 13b | `wordAfter` reads one UTF-16 unit | "an astral letter after (#1𝐀)" |
| 14 | S2's plain-text test dropped | "S2 does not mark a bold holding inline code or a link" |
| 15 | the after-lead flag not reset after a non-paragraph block | "… with a heading / a fence / another list between is not marked" |
| 16 | a commit allowed after `.`, `/`, `-` | `feat-4c677d328`, `v1.2.4c677d328`, `a/4c677d328` |
| 17 | a document path allowed to run on into `/` or `-` | `docs/a.md/x`, `docs/a.md-bak` |
| 18 | a commit allowed before `-` | "a UUID's head (4c677d32-…)" |
| 19 | a commit allowed before `.` and a word character | `abc1234.ts` |
| 20 | the exponent rule dropped | `1e10000`, `10e1000`, `e1234567` |
| 21 | a document path allowed before `.` and a word character | `docs/plan.md.bak` |
| 22 | S1 applied to the header row | "S1 does not label a header cell" |
| 23 | any `.` after a name refuses it | "at abc1234. (sentence end) is still a name", "docs/conventions/x.md. (trailing full stop outside)" |

Gates, one at a time through `ccrc test`, all green:
- chat-marks, remark-chat-marks, markdown-parse, render-hast and markdown-purity: 255 tests;
- markdown-golden under `CI=1`: 173 of 173, every stored file byte-identical;
- the pwa type check: clean;
- the whole pwa suite: 466 files, 13 765 passed, 3 skipped;
- `server/test/single-definition/`: 23 files, 1 084 passed.
