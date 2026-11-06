# Task C: colour in the assistant's prose (D-8061), worker's note

Task C of [the chat reading plan](../2026-11-06-chat-reading.md). This note records what the task measured and where it
departs from the plan's text, by slug, for the coordinator to fold into the plan's ledger. It defines no number.

## Step 0, measured on the base (6637ad604)

The plan's Task C has no Step 0 of its own: its steps start at the scrape. What was measured on the base before any
edit, as the footing the gates below compare against:

- `node design/contrast-check.mjs`: ALL 9708 PASS, 196 rules uncovered.
- Task M's plugin, as landed, writes `data-lead` (`action`, `info`) on a root-level lead-in's `strong`,
  `data-after-lead='action'` on the root list straight after an action lead-in, and `data-status` (`ok`, `merged`,
  `wait`, `fail`) on a status word's `span` or bold, never in a table's header row. M's note
  (`2026-11-06-chat-reading/m.md`) says what each one means.
- T4a's chip rule (`.msg-assist:not(.doc-body):not(.compaction-body) .md-code`, D-7234) is the last rule before the
  keycaps in `prose.css`'s `@layer components`. The new rules sit straight after it.
- `browser/chat-colour.browser.test.ts` against the base's `prose.css`: 16 of 16 views red, at the first colour
  assertion (an info lead-in drew `--ink-primary`, not `--acct-blue`).

## Gate figures

`node design/contrast-check.mjs` after the change: ALL 9792 PASS (84 new pairs: 7 rules in 12 palettes), 196 rules
uncovered, as on the base. The lowest ratio per pair, which replaces the spec's §3.1 figures:

| Rule | Pair | Lowest | Palette |
|---|---|---|---|
| action lead-in | `--status-attention-text` on `--bg-page` | 5.45 | light |
| info lead-in | `--acct-blue` on `--bg-page` | 5.36 | catppuccin-latte |
| action list marker | `--status-attention-text` on `--bg-page` | 5.45 | light |
| status ok | `--status-busy-text` on `--accent-tint` | 4.84 | gruvbox-dark |
| status merged | `--pr-merged` on `--acct-violet-tint` | 4.80 | dracula |
| status wait | `--status-attention-text` on `--status-attention-tint` | 4.80 | nord |
| status fail | `--status-dead-text` on `--status-dead-tint-solid` | 4.81 | light |

The gate agrees with the spec's figures to the second decimal on every pair.

## Departures, by slug

- **`no-step-0-in-task-c`.** The brief asks for "Step 0 as the plan words it". Task C has none, so the base was measured
  as above.
- **`docs-reader-by-cloned-markup`.** The browser case "the Docs reader keeps ink" does not open the Docs reader. The
  docs profile writes no mark (M's "the docs profile carries no chat mark"), so a real Docs page carries no attribute,
  and dropping the scope's `:not(.doc-body)` (mutant 1) could not red it. The case clones the chat message's own marked
  nodes into an `<article class="msg-assist doc-body">`, the class pair the Docs view and its export draw, and asserts
  that every marked element draws the same ink, ground, weight and padding with its attributes as without them.
  "An opened recap keeps ink" uses a real opened recap, where the chat profile does write the marks. A clone into a
  plain `.msg-assist` is the control: there the same comparison must differ.
- **`scrape-own-selector-reader`.** `chat-colour.test.ts` carries its own selector normaliser and its own top-level
  comma split. `cssRule.ts`'s `normSel` drops the space after a `)`, which reads `…:not(.compaction-body) strong` as one
  compound, and its readers split a selector list at every comma, including the one inside `:is(ul, ol)`. `cssRule.ts`
  is shared and outside this task's files, so it is unchanged.
- **`extra-scrape-cases`.** Two cases beyond the plan's list: "a status word is drawn as a small label" (the label
  rule's radius, inline padding and weight, and that it sets no colour or ground of its own), and "the rules sit inside
  @layer components, after the T4a chip rule" (the plan's placement).
- **`browser-views-are-the-harness-views`.** The browser file runs `tool-well-colour.browser.test.ts`'s 16 views (both
  skins, Phosphor and light, at 360, 390, 1280 and 1920), which include the PR's pictures at 1280 and 390.
- **`browser-cases-as-assertion-messages`.** The plan's five browser cases are carried as the messages of the
  assertions inside one test per view, as the harness file does. Each red names its case.
- **`contrast-and-prose-tests-unchanged`.** `contrast.test.ts` and `prose.test.ts` are listed "modify, as each asks".
  Neither asked: both stay green unchanged. `contrast.test.ts` reds on its own when a ground entry goes (mutant 5).

## Mutants

Each was written into the named file, run against the named test, and restored from a saved copy with its sha256
checked. All went red on the named case, and the tree was clean after each.

| # | Mutant | File | Red case |
|---|---|---|---|
| 1 | the scope's `:not(.doc-body)` removed from the eight new rules | `prose.css` | `chat-colour` "every new rule's selector starts with the T4a scope", "no rule in prose.css names data-lead, data-after-lead or data-status without it"; browser "the Docs reader keeps ink" (16 of 16 views) |
| 2 | the info lead-in on `--acct-cyan` | `prose.css` | `chat-colour` "each lead-in rule reads its token" |
| 3 | the marker rule deleted | `prose.css` | `chat-colour` "the action list's marker reads --status-attention-text"; browser "action lead-ins and their list markers are amber, info lead-ins blue" (16 of 16) |
| 4 | the fail tone's ground changed to `--status-dead-tint` (translucent) | `prose.css` | `contrast-check.mjs`: 12 FAILURES of 9792, "background var(--status-dead-tint) is translucent and has no GROUNDS entry" |
| 5 | the info lead-in's `INHERITED_GROUNDS` entry deleted | `audit.mjs` | `contrast.test.ts` "contains no identities beyond the grandfathered blind spots", naming the info lead-in rule |
| base | `prose.css` as on the base | `prose.css` | browser, 16 of 16 views (Step 3's "run on main's tree") |

## Gates

Run one at a time through `ccrc test`:

- `chat-colour.test.ts`, `prose.test.ts`, `prose-lists.test.ts`, `shape-census.test.ts`, `contrast.test.ts`: green.
- `node design/contrast-check.mjs`: ALL 9792 PASS.
- The whole pwa suite, on its first full run after the implementation was complete: 1 red,
  `browser-dist.test.ts` ("every file that serves the app serves sharedDist()"). The browser file wrote
  `serveDist(sharedDist())` in place of the house's `dist = sharedDist(); server = await serveDist(dist);`, which that
  guard reads by text. Fixed, and on re-run: 468 files, 13 826 passed, 3 skipped.
- `chat-colour.browser.test.ts` and `tool-well-colour.browser.test.ts`: 32 of 32.

## Fix round 1 (review 1584)

Review 1584 read the tip c70242de5 and raised five findings, none blocking. The coordinator ruled on each (mail 16116).

- **F1, departure `c-s3-negation`** (amends spec §3.3's S3; the coordinator records it in the ledger). A status label
  must not say the opposite of its sentence. `chatMarks.ts` gains `STATUS_NEGATORS` (no, none, not, never, nothing, 0,
  zero), and S3 withholds the label, keeping the mark, when:
  - a negator stands before the status word in its clause (before the subject, or between the two). A clause ends at
    `.`, `!`, `?`, `;`, `,` or `:` followed by a space or the end, or at a line break, so "0 tests failed, 12 tests
    passed" keeps the second label;
  - a negator is the word's count behind a colon ("tests passed: 0 of 12", "checks failed: none");
  - its sentence ends in `?` ("Has #651 merged?"). A sentence ends at `.`, `!` or `?` followed by a space or the end,
    or at a line break.

  Only S3 changes: a bold status word (S2) and a table cell's first word (S1) are unchanged. Between a subject and its
  word a negator already gave no label, since S3 allows only a linker there. A negator or `?` in another text node (past
  a bold or a code span) is not seen. The cases are `pwa/test/chat-marks-negation.test.ts`: the review's five inputs,
  each negator word, the positives the ruling names ("3 tests failed", "the build failed", "#651 merged"), and
  boundaries (a comma, a full stop, `10`, a file name's dot). No markdown golden changed: no corpus case holds a status
  label.
- **F2.** A checked task item's lead-in keeps no lead colour. The two lead rules end in
  `:not(.task-list-item:has(> input:checked, > p:first-child > input:checked) *)`, the DONE rule's own test. The bold
  then draws the prose's bold ink (`.msg-assist strong`, `--ink-primary`), as every bold in a done item does today, under
  the item's line-through; the item's `--ink-tertiary` does not reach a `strong`, which sets its own colour, so the
  lead-in is not dimmed, only uncoloured. Dimming a done item's bold would change the Docs reader and the recap too,
  which this task keeps as they are. The two `INHERITED_GROUNDS` entries are re-keyed to the new selectors.
- **F3.** The pictures are not attached to the public PR. They are held for the operator in this session's clips
  folder, listed in the wave-done.
- **F4.** "the rules sit inside @layer components, after the T4a chip rule" loops over all eight rules.
- **F5.** The scrape blanks statement at-rules (`@layer a, b;`, `@import`) before reading, and reads an attribute name as
  the engine does: in any case, with spaces inside the bracket and CSS escapes undone. Planted cases pin each spelling.

### Mutants, fix round 1

Every mutant above was re-run on the fix round's tree and went red on its named case again. Mutant 2 now changes the
info lead-in rule's colour on its new selector; mutant 5 deletes its entry under the new key. The new ones, run the
same way (saved copy, sha256 checked on restore):

| # | Mutant | File | Red case |
|---|---|---|---|
| N1 | the negator half off (`isNegator` always false) | `chatMarks.ts` | `chat-marks-negation` 11 of 23, each "no label" row of the negator half and "the mark stays: a PR is still a PR" |
| N2 | the question half off (`?` never withholds) | `chatMarks.ts` | `chat-marks-negation` "a sentence ending in "?" gives no label, and keeps its mark", "the question governs its own sentence only" |
| N3 | the checked-item exclusion dropped from both lead rules | `prose.css` | `chat-colour` "a checked task item's lead-in keeps no lead colour"; browser, the same case, 16 of 16 views |
| X7 | the `ok` rule moved out of `@layer components` | `prose.css` | `chat-colour` "the rules sit inside @layer components, after the T4a chip rule" |
| N5a | the reader no longer blanks statement at-rules | `chat-colour.test.ts` | `chat-colour` "after @layer a, b; is an unscoped rule", "after @import is an unscoped rule" |
| N5b | attribute names compared as written | `chat-colour.test.ts` | `chat-colour` "a space inside the bracket…", "upper case…", "an escaped hyphen is an unscoped rule" |
