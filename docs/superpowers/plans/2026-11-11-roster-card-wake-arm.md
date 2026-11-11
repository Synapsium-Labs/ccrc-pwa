# The roster card's wake arm and its one builder (R-5a)

## Goal

The worktree-economy spec's R-5a (`docs/superpowers/specs/2026-10-28-worktree-economy-design.md`, "The wake arm for
D4"): Claude Code's idle compaction runs about an hour after a turn ends and starts no turn, so none of the roster
card's three SessionStart events (compact, resume, clear) fires, and a coordinator next wakes on mail with a compacted
context and no roster. The wake must carry the same card, built by the same code, as its first block, under the card's
switch (`coordinator-roster-card-live`) and with its shadow log. The card text gets one shared builder.

## What was read first

- `ccd/session-hook.sh`'s SessionStart arm held the card: a jq program in a shell variable and `_hook_roster_card`,
  both defined inside the arm, so nothing outside SessionStart could call them.
- The wake is the server's. The mail lane types `renderMailNudge` (`server/src/coord/envelope.ts`) into an idle
  recipient, and the idle-compaction lane types `IDLE_COMPACT_NUDGE_PROMPT` once per idle compaction
  (`server/src/idlenudge.ts`, D-5373). ccd has no mail or nudge path of its own. Both texts are fixed: the mail
  nudge's 24-character head is `sendPrompt`'s echo needle, and the transcript parser reads the idle nudge's whole
  trimmed text as a pill, so neither can carry a card in the typed text without breaking those readers.
- The server reads the transcript tail for the idle nudge (`readCompactionTail`, `isIdleCompaction`); ccd and the
  doctor read transcripts through `ccd/lib/transcript.jq` (ARCH-65), loaded with `jq -L`.

## Deviations found

- **D-8201 (2026-11-11)** — R-5a's wake arm runs in the session hook, not in the server's mail lane: the card reaches the wake turn as the hook's UserPromptSubmit `additionalContext`, and its one builder is `ccd/lib/roster-card.jq`. The spec puts the arm in "the server's mail-wake path". Two facts moved it. The server cannot run the hook's builder (a jq program over `ccrc-api runs list` on the fleet box), so a server-side card would be a second builder, which the spec forbids. And the wake texts are fixed (the mail nudge's head is `sendPrompt`'s echo needle, the idle nudge is read whole as a pill), so a card cannot ride in them. The hook sees the same wake from the receiving side: a main-thread UserPromptSubmit whose prompt begins with one of the server's two wake texts, when the transcript's newest compaction is an idle one with no turn since (`idle_compaction_open` in `ccd/lib/transcript.jq`, the box's spelling of `isIdleCompaction(t) && !t.turnAfter`). The card's text moved verbatim into `ccd/lib/roster-card.jq` (`roster_card`), loaded with `jq -L` beside `transcript.jq`, where ccd can load it too; `_hook_roster_card` moved above the hook's `case` (the D-4748 exception: the SessionStart arm and the tail both call it) and takes the event word for its shadow line (`compact`, `resume`, `clear` or `wake`). One server read, one switch and one shadow log serve both callers. The installers place the builder beside `transcript.jq` (deploy.sh's agent lane, `ccrc install`, `ccrc update`'s backup, `ccrc uninstall`). The switch's Settings row (R-6) is not part of this change: the card, wake arm included, is still armed by the hand-touched marker until that row lands.

## Design

- **One builder.** `ccd/lib/roster-card.jq`, `roster_card($me; $now; $max)`, is the old program moved byte for byte
  into a jq module. The hook loads it from the lib directory beside the hook (`ccd/lib` in a tree,
  `~/.cc-sessions/lib` installed); a missing file is no card. A characterization test pinned the card's exact text
  before the move.
- **One function, two callers.** `_hook_roster_card <event>` makes the one bounded server read, runs the builder, and
  then either sets `CARD_ROSTER` (armed) or appends the shadow log (unarmed). `_hook_roster_eligible` is the one
  spelling of "main thread, not a child, card kill switch absent". The SessionStart arm calls it on compact, resume and
  clear, as before. The wake arm calls it with `wake`.
- **The wake arm.** It sits in the tail, after the hookstate write and the PreToolUse print site, so the turn is on disk
  before any read. A builtins-only prefilter (the payload holds one of the two wake texts) keeps every other prompt
  free. Then one jq reads the prompt and the transcript path, one `tail -c 262144 | jq` reads the newest compaction,
  and an armed card is printed as one UserPromptSubmit envelope. A turn that already ran since the compaction means
  the card went out on that wake, so the second wake is silent.
- **Parity.** The hook's two wake texts are held to `renderMailNudge` and `IDLE_COMPACT_NUDGE_PROMPT`, the jq notice
  prefixes to `IDLE_COMPACT_NOTICE_PREFIXES`, and `idle_compaction_open` to `readCompactionTail` and
  `isIdleCompaction`, over one table.

## Tasks

- [x] T1. Characterization: the card's exact text, green against the in-hook builder.
- [x] T2. Move: `ccd/lib/roster-card.jq`, `_hook_roster_card` above the `case`, the installers, and the single-definition
  guard (`server/test/single-definition/roster-card.test.ts`).
- [x] T3. Tests first, red: the wake arm (armed, unarmed, every silent path), the reader parity table, the wake-text
  parity, and the ship pins. Then build: `idle_compaction_open` and the hook's wake arm.
