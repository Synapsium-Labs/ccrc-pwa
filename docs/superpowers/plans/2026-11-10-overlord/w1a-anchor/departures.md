# The anchor: departures from the plan, and what was measured

Plan: `docs/superpowers/plans/2026-11-10-overlord/w1a-anchor.md`, Tasks 1 to 3 (one PR). Each departure is named by a slug.
The one number this piece was issued, D-8630 (the growth waiver of fix round 1, below), is defined here, where the
coordinator issued it. The coordinator folds these into the ledger.

## Deviations found

- **D-8630, anchor-hook-growth, scope** (2026-11-14) — `ccd/session-hook.sh` grows past `GROWTH_LIMIT` by the anchor
  piece with the fixes of review 2062: measured +45 net code lines against the merge base (2960 to 3005), +38 at the
  reviewed tip and +7 in fix round 1, almost all of them F5's one network budget (`_hook_net_bound` and its call sites).
  Waived to 45 on the coordinator's ruling of ask 419 (`server/test/growth-waivers/D-8630-session-hook.json`): the reads
  it bounds run on the SessionStart and prompt paths themselves, and the hook loads no library. The hook was not
  compressed to fit, and the budget was not moved into a library, on the same ruling.

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
  (`ccrc-role:`, `ccrc-roster:`) and the fork's line does in the plan. The hook checks it (below).
- **anchor-proves-itself** (fix round 1, F1). The plan's door answers did not say what they were, and an older server's
  card door ignores `part` and answers page 1 of the full card, which a new hook took as the anchor through the rollout
  window (the fleet box updates first by default). Every `part=anchor` answer now names `part: "anchor"` and the form it
  served (`anchorAnswer`). `ccrc-api card --anchor` prints only an answer that names both, as the form it asked; any other
  answer prints nothing and exits 3, as no answer does. The hook checks the same proof, and takes a text only when it
  begins `ccrc-anchor: `: anything else is no answer, so every source prints what it printed before, the role card
  stands, and the owed mark is not cleared (a prompt spends a try on it, as on no answer). The request also asks for
  `page=0`, which the card door has refused since before the anchor (its pages start at 1) before the attribution, the
  gather or any write, so an older server stores no snapshot and records no card read for the hook's read. The new door
  takes `part=anchor` only with page 0 and no hash.
- **generation-none.** With no live generation for the identity (a plain session, or a coordinator before its first
  mint), the canary reads `term none · generation none`. `n+1 starting` is read only beside a live generation, when the
  session's newest start (`startsOf(id, 1)`) is newer than that generation's start.
- **anchor-before-start-report.** At a start the hook asks for the anchor in the SessionStart arm, before
  `_hook_start_report` (in the tail) sends that start. So a start's own anchor names the generation before the start it
  is part of; the canary reads `n+1 starting` only for a start the server already holds and the lane has not minted (a
  start report that was resent, or a lane pass still to run). The next prompt's anchor and the card read see the new
  generation. Reordering the two would move the start report into the arm, past the growth check's 40 lines. Since fix
  round 1 (F2) the start form says so in plain words, `term T · generation N (this start not yet reported)`
  (`ANCHOR_START_NOT_REPORTED`), and carries NO card hash: the card read once the lane mints the start can carry another
  hash (its checkpoint follows the live generation), so a hash there would set up a false mismatch. The prompt form,
  read later, keeps both canaries.
- **anchor-eligibility-is-the-roster-rule.** The hook asks only where `_hook_roster_eligible` holds (the main thread, not
  a child, no card kill switch), the one spelling of "may carry a card". So the card kill switch silences the anchor too,
  as it does the role card.
- **source-less-start-keeps-the-role-card.** A SessionStart with no `source` (an older harness) makes no anchor read and
  prints the role card as before: the plan serves the anchor on `startup`, `resume`, `clear` and `compact` only.
- **one-envelope-per-prompt.** A prompt whose roster card wake arm printed its envelope keeps the `anchor-owed` mark
  untouched (no read, no try counted), so an event never prints two envelopes; the next prompt carries the anchor.
- **one-network-budget** (fix round 1, F5; replaces a-hung-server-costs-one-bound). The plan adds a third bounded read to
  a start (the anchor's, beside the roster card's and the start report's) and a read to a prompt (the owed anchor's,
  beside the start report's resend and the roster wake's). Review 2062 measured 11.7 s for a compact start against a
  server that answers in 3.9 s, and 11.9 s for a hung server on a mail-wake prompt with a spooled start and a mark
  standing; the worst case before the anchor was 8 s. Every server read of one invocation now asks `_hook_net_bound`
  first: ONE deadline, 8 s (`HOOK_NET_BUDGET_MS`) after the first read asked, each read bounded by the smaller of its own
  bound (4 s; the start report's 4 s budget) and what is left, none started with under a second left, and none started
  once a read has run out its bound (`timeout`'s 124 sets `HOOK_NET_HUNG`, set empty at load, so the environment cannot
  set it: F7). A start report the budget does not start stays spooled, as one with no time left did; an owed read the
  budget does not start keeps its try. A refusal or a fast failure is no hang, and the next read runs as before.
- **owed-tries-in-mark.** The mark holds the tries already spent (0 to 2); a third prompt with no answer removes it.
- **a-child-spends-its-mark.** `_hook_compact_pre_line` marks on a main-scope `auto` line whoever the session is; a
  child's prompt makes no read (the eligibility rule) and spends the mark within three prompts.
- **owed-mark-guards** (fix round 1, F3, F4, F6, F8). The mark is written only when the PreCompact payload's trigger reads
  exactly `auto` (the event line records a missing trigger as `auto`), and never opened when a FIFO, a symlink or a
  directory stands at its path (the siblings' rule in the same lock: an open of a FIFO would block inside the held
  lock). A start whose anchor read answered clears it whatever its source, a fork included, so a later prompt never
  prints a second anchor, nor the original's in a forked copy. After the owed read's try-count write the row's
  `generation` is looked at again, and the mark removed if a purge took the row during the read.
- **anchor-on-its-own-lines** (fix round 1, F9). A newline, not a space, joins the anchor to the next slot, so its lines
  stay lines; the pinned sum (1500 + 1 + ...) counts that one character as before.

## What was measured

- The hook's net code-line growth (the growth check's count, armed, against the merge base 3afa9aeb7): 2,960 to 3,005,
  +45, waived to 45 under D-8630 (above). The reviewed tip was +38.
- Fix round 1, the timings of the one budget (`session-hook-anchor.test.ts`, stub servers, whole hook runs): a hung server
  costs a startup, resume, clear or compact start about 4.0 s each (one bound; review 2062 measured 7.9 s), and a fork
  4.0 s (its one read; 0.03 s before the anchor). A server that answers in 3.5 s costs a compact start 7.1 s (the anchor and
  the roster card answered; the start report, with under a second left, stays spooled). A hung server costs a mail-wake
  prompt with a spooled start and a mark standing 4.0 s (the resend runs out; the owed read never starts and keeps its
  try), and the wake path with a mark standing 4.1 s (the roster wake's read runs out; the owed read never starts).
- Fix round 1, mutations, each restored from a saved copy and each red on its case: the hook's proof of part and form;
  its prefix check; the FIFO guard; the `auto` trigger check; the mark cleared on compact only; no generation re-check;
  a space join; the roster read, the start report and the anchor read each off the budget; a skipped owed read
  spending its try; a send that runs out not marking the server hung; the hung flag not set at load (13). The client's
  proof check and its page 0; the door's page-0 rule (3). The anchor's sets gained A11 (the start form as if reported, with
  the hash), S3 (an answer without its part) and S4 (an answer naming another form): every mutant killed.
- The characterization: at the branch point (main `2d503a4de`), a coordinator fixture's five SessionStart sources print
  the role card alone (`startup` and `clear` the fresh text, `resume`, `compact` and `fork` the short one), with the
  client failing. `session-hook-anchor.test.ts` pins those five envelopes byte for byte with the read failing, with no
  client, and with the door answering `dark`.
- Mutations of the hook, each restored from a saved copy: the anchor after the standing card, the fork line set without
  asking the door, the mark on any scope, the prompt read before the hookstate write, the compact start keeping the mark,
  a `dark` answer keeping it, the role card printing beside the anchor, and the roster read not standing down after a
  hang. Each reddened its case. Of the door: the text served in shadow, and the role line served unmasked; each reddened
  its case in `continuity-card-route.test.ts`.
- The anchor's mutant sets (`server/test/sim/anchorSets.ts`, at floor 1 in `mutation-floors.json`): `renderAnchor` (ten
  mutants, the plan's four first), `anchorGeneration` (five) and `anchorAnswer` (two, the first the plan's "serve the text
  in shadow"). Every mutant killed.
- The migration slot: `main` held 72 entries when this branch first absorbed it (after timers PR B, #2798), so this entry
  was 73. Probes PR B (#2802) landed first and took 73, so at the absorb of 19835 (`main` measured at 73 entries) this
  entry moved to 74, the next free slot, after the probes' entry; `coord-db.test.ts` pins it there and upgrades a
  database at 73 to it.
