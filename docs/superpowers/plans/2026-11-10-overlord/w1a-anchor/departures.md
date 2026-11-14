# The anchor: departures from the plan, and what was measured

Plan: `docs/superpowers/plans/2026-11-10-overlord/w1a-anchor.md`, Tasks 1 to 3 (one PR). Each departure is named by a slug;
no deviation number was taken. The coordinator folds these into the ledger.

## Departures

- **anchor-cap-in-bytes.** `ANCHOR_CARD_MAX_CHARS` (1,500) and `ANCHOR_PROMPT_MAX_CHARS` (600) are applied by
  `renderAnchor` in UTF-8 bytes, not characters. A byte bound is also a code point and a UTF-16 bound, so the anchor fits
  however Claude Code counts its 10,000-character cap, and the hook's own clip at the same number (`${4:0:1500}`, which a
  bash in the C locale counts in bytes) never cuts a server answer, nor splits a character. The size is pinned in ASCII and
  in four-byte text (`continuity-anchor.test.ts`), as the brief's ruling asks.
- **anchor-input-beside-facts.** The plan's signature is `renderAnchor(facts, gen, form)`. The canaries need the card's
  hash as well as the generation, so the second argument is `{ cardHash, generation }`, which the door reads beside
  `CardFacts` (`liveGenerations` and `startsOf`, both existing store reads). `CardFacts` and `cardFacts.ts` are unchanged,
  so this piece never meets timers PR B's move of the role read there. A fourth argument, `mask`, is the card door's one
  masker (below).
- **role-masked-before-fit.** The anchor is card text and goes through the card's one masker, the same instance the card
  door masks the card with, never a second masker. It is applied to the role line, the one part a row's text reaches (a
  programme slug, the role's reason), BEFORE the line is fitted: a masker that lengthens a line can then never push the
  anchor past its ceiling, which masking the whole text after fitting could. The other lines are numbers, fixed words and
  twelve hex characters of the hash.
- **prompt-form-bounded-by-construction.** The prompt form (the canaries and the instruction) carries no row's text and
  is never cut: its worst case (the largest safe integers) is pinned under 600 by a test. A clip there could never go red,
  so it is not written (the plan's mutant "let `prompt` exceed 600" is the prompt form taking the role line, which reddens).
- **anchor-prefix.** The anchor's first line begins `ccrc-anchor: `, as every other hook subject carries its own prefix
  (`ccrc-role:`, `ccrc-roster:`) and the fork's line does in the plan.
- **generation-none.** With no live generation for the identity (a plain session, or a coordinator before its first
  mint), the canary reads `term none · generation none`. `n+1 starting` is read only beside a live generation, when the
  session's newest start (`startsOf(id, 1)`) is newer than that generation's start.
- **anchor-before-start-report.** At a start the hook asks for the anchor in the SessionStart arm, before
  `_hook_start_report` (in the tail) sends that start. So a start's own anchor names the generation before the start it
  is part of; the canary reads `n+1 starting` only for a start the server already holds and the lane has not minted (a
  start report that was resent, or a lane pass still to run). The next prompt's anchor and the card read see the new
  generation. Reordering the two would move the start report into the arm, past the growth check's 40 lines.
- **anchor-eligibility-is-the-roster-rule.** The hook asks only where `_hook_roster_eligible` holds (the main thread, not
  a child, no card kill switch), the one spelling of "may carry a card". So the card kill switch silences the anchor too,
  as it does the role card.
- **source-less-start-keeps-the-role-card.** A SessionStart with no `source` (an older harness) makes no anchor read and
  prints the role card as before: the plan serves the anchor on `startup`, `resume`, `clear` and `compact` only.
- **one-envelope-per-prompt.** A prompt whose roster card wake arm printed its envelope keeps the `anchor-owed` mark
  untouched (no read, no try counted), so an event never prints two envelopes; the next prompt carries the anchor.
- **a-hung-server-costs-one-bound.** The plan adds a third bounded read to a start (the anchor's, beside the roster card's
  and the start report's), so a server that hangs would cost a compact start about 12 s instead of 8, which
  `session-hook-roster-card.test.ts`'s "a server that hangs" case (under 10 s) caught. When the anchor's read runs out its
  bound (`timeout`'s 124), the roster card's read in the same event stands down: the server has just failed to answer in
  4 s. A refusal or a fast failure is no hang, and the roster read runs as before.
- **owed-tries-in-mark.** The mark holds the tries already spent (0 to 2); a third prompt with no answer removes it.
- **a-child-spends-its-mark.** `_hook_compact_pre_line` marks on a main-scope `auto` line whoever the session is; a
  child's prompt makes no read (the eligibility rule) and spends the mark within three prompts.

## What was measured

- The hook's net code-line growth (the growth check's count): 2,960 at the branch point, 2,997 after, +37 of 40.
- The characterization: at the branch point (main `2d503a4de`), a coordinator fixture's five SessionStart sources print
  the role card alone (`startup` and `clear` the fresh text, `resume`, `compact` and `fork` the short one), with the
  client failing. `session-hook-anchor.test.ts` pins those five envelopes byte for byte with the read failing, with no
  client, and with the door answering `dark`.
- Mutations of the hook, each restored from a saved copy: the anchor after the standing card, the fork line set without
  asking the door, the mark on any scope, the prompt read before the hookstate write, the compact start keeping the mark,
  a `dark` answer keeping it, and the role card printing beside the anchor. Each reddened its case.
- `renderAnchor`'s mutant set (`server/test/sim/anchorSets.ts`, ten mutants, the plan's four first): every mutant killed.
