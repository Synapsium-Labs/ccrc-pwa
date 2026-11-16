# A carried-in banner is not a block — Plan

> **For agentic workers:** a single-task fix, done in one commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a session moved onto a new account is not moved again on the rate-limit banner it carried in
from the old one — unless Claude Code never came up on the new account, in which case it is still moved,
now on purpose.

**Background, measured 2026-09-28** (read-only census over the swap log, the lifecycle journal and the
transcripts; the rescue replayed in a fixture HOME):

- `cmd_swap` carries the transcript with every row's original timestamp, so the old account's
  `error:"rate_limit"` row arrives unchanged. It stays the newest real row when the new process writes
  nothing: (a) the landing's TUI never came up (`_spawn_settle` rc 4 at about L+923 s, a blank pane), or
  (b) Claude Code declines to re-drive a turn whose API-error row is at least 6 h old (2.1.28x default,
  `tengu_resume_stale_turn_suppressed`). Once `SWAP_COOLDOWN` lapses, `_session_hard_blocked`'s transcript
  arm reads it as a block and the session is rescued again. D-3100's argument that the cooldown keeps a
  re-render from reaching a relocation is false: the cooldown expires. D-3522 closed the same shape for
  401 rows only.
- Since 2026-09-08: 259 auto-rescues, 26 on a banner written before the session landed on the account it
  was rescued from (25 via=transcript, 1 via=pane), 194 fresh, 37 with no landing in the log, 6 undatable.
  None since 2026-09-16 and none since 2.1.280 reached the fleet. 24 of the 26 were landings whose TUI never
  came up; the false rescue moved them off a non-starting target (the 2026-09-15 herd bounced
  between two accounts for an hour until a third account started them). 1 was the 6-hour
  re-drive suppression; 1 was a pre-#182 pane match.
- The continuity spec (C12, stage 4 rule 1, slug `carried-in-banner-is-not-a-block`) dates the banner
  against a new `$REG/<id>.landed` stamp. D-3522 already dates a 401 against the pane's own process start,
  tmux `#{session_created}` (`_pane_born`; ccd creates a fresh tmux session per spawn). On the measured
  data the two carriers suppress the identical 26 and none of the 194 fresh rescues; they differ only on a
  same-account restart, where a pre-restart row stops counting under `_pane_born` — and Claude Code's own
  resume re-drive writes a fresh row within seconds when the block is real and under 6 h old. (Round 1
  closed that difference with a second condition, a swap after the row: design item 2.)
- `$REG/<id>.spawn` holds `<settle epoch> <rc>` and is rewritten on every settle (only the journal line is
  debounced), so "this process never came up" is readable: `.spawn`'s epoch ≥ `_pane_born` and its rc is 4.

Operator ruling 2026-09-28: build it now on D-3522's carrier; a session whose Claude Code never started on
the new account is still moved.

## Task 1: date a rate-limit positive against the pane's process

**Files:** `ccd/ccd` (`_transcript_limit_banner`, `_session_hard_blocked`, new `_limit_dated`, `_limit_read`,
`_never_came_up`, `_pane_carried_in` and `_carried_in_note`, the
`_pane_limit_banner` header's D-3100 sentence, the `RESUME_REDRIVE_MAX_AGE_MS` comment, the `_reg_purge`
inventory prose, the `_reg_get` census sentence), `server/test/ccd-limit-banner.test.ts`, `README.md`.

Design:

1. **Reader.** `_transcript_limit_banner`'s `stuck` mode gains a proof-only gate for rate-limit rows: a
   `predates(row)` beside `born()`, true only when `since` is digits, the row's timestamp parses, and it is
   `< since`. When the newest real row is a rate-limit row that predates `since`, answer **rc 3** and print
   that row's epoch. Everything else is unchanged: no `since`, a non-digit `since` or an unparseable
   timestamp counts the row (today's behaviour — a positive is never taken away without proof); equal
   seconds count; the default mode is byte-for-byte unchanged; the `rate_limit` comparison stays the file's
   first `row.get("error") ==` line (pinned); the 401 arm is untouched. The rc mapping passes 3 through.
2. **Verdict.** In `_session_hard_blocked`:
   - transcript rung: rc 0 → blocked; rc 3 → not blocked, unless this process never came up (below);
     the 30 s `tscan` cache keeps its `<now> <0|1>` shape;
   - pane rungs (`_pane_hard_blocked`, `_pane_limit_banner`): on a positive whose pane is not an auth
     failure (`Invalid API key|Please run /login`), run the same stuck-mode read UNCACHED with the pane's
     born; rc 3 → not blocked (clear `HARD_BLOCK_VIA`), unless this process never came up; any other
     answer, an unresolvable transcript or an empty born keeps the positive;
   - "never came up": `$REG/<id>.spawn`'s epoch is ≥ `_pane_born` and its rc is 4. Then a carried-in row
     stays a block, so the session is moved exactly as today.
   - **carried in needs a swap after the row** (round 1, ruling 1): rc 3 counts as carried in only when
     `$REG/<id>.lastswap`'s epoch is strictly later than the row's epoch. `lastswap` is stamped by the
     rescue and affinity dispatches and by `cmd_swap`'s landing, and `_swap_refuse` deletes it. A
     missing, unreadable, torn or not-later `lastswap` means the row is this account's own: a block. The
     clock alone could not tell a swap-carried row from one the same account wrote before a restart (an
     OOM kill, a revival, stop/start), so a restart more than 6 h after a real block retracted the strand
     and was never moved when a target freed. The check sits in `_limit_dated`, after the reader: the
     reader's default mode and its 401 arm are unchanged, and rc 3 still means only "older than since";
   - **the dated read is cached on the process and the file** (round 1, ruling 2): `_limit_read` keeps
     the reader's answer in `$REG/<id>.tdate` = `<born> <mtime> <size> <rc> <row-epoch|-> <path>` and
     reads the transcript again only when a key changes. Any appended row grows the file, so a fresh
     block is never hidden by the cache. `lastswap` and `.spawn` are read after it on every call, never
     cached; rc 2 is never cached; an unknown born or an unmeasurable file reads uncached. Both rungs
     share it, so a stranded pane positive, asked every 5 s tick for hours, re-reads nothing until the
     file changes.
   Both consumers — the rescue arm and the strand half (`_tick_strand_undecidable`, and the no-target
   strand) — get the rule through `_session_hard_blocked` with no edit of their own.
3. **Telemetry.** `_carried_in_note <id> <via> <row-epoch> <born>` appends one swap-log line per process:
   `carried-in <id>: via=<transcript|pane|banner> rate-limit row at <epoch> predates this pane's process
   (born <born>) — not a block [wrapper=<w>] [spawn=<rc>]`, floored by `$REG/<id>.carriednote` = the born
   last noted (a new process is a new floor). `carriednote` and `tdate` join the registry fields that
   purge with the row (the purge is suffix-shaped; update its inventory prose and count).
4. **Prose.** Amend D-3100's sentence in place; correct the `RESUME_REDRIVE_MAX_AGE_MS` comment ("empty =
   no age cap" is false on 2.1.28x, whose default is 6 h); re-measure the `_reg_get` census sentence.
5. **Line budget.** New functions go BELOW `ccd/ccd` line 21428 (the highest cited line); above it, edit in
   place; if a line must move above it, run the S6-R11 procedure in this commit.
6. Do NOT touch `_redrive_after_spawn`'s pane stand-down or `_accept_first_run_prompts`' rc 5 (D-2364;
   neither relocates anything; 0 measured firings of the former).

- [x] Red: the tests below, each measured red before the fix.
- [x] Green: design items 1–4.
- [ ] Re-stamp `ccd/ccd`; confirm or re-measure the citation census; mutation table; full sharded server
  suite plus PWA, agent, build and tsc.

Tests (red first; `BANNER_AT` = the fixture banner's epoch, `TMUX_CREATED` routes `_pane_born`):
- reader: `[human, banner]` with `since = BANNER_AT+60` → rc 3 and the banner's epoch — red today;
  controls: `since = BANNER_AT` → 0; no or non-digit `since` → 0; an unparseable timestamp → 0; a fresh
  banner after the carried one → 0; default mode → 0; `[banner, META prompt]` → 1; the existing "still reads
  a rate limit as stuck, with or without a since" case rewritten (no since → 0; since ≤ row → 0; since > row
  → 3);
- transcript rung: carried banner, a settled `.spawn` rc 0 → no dispatch, exactly one `carried-in … via=
  transcript` line, `carriednote` = born; a second tick writes no second line; a new born writes one —
  red today; control: `TMUX_CREATED` before the banner → dispatch `via=transcript`;
- never came up: carried banner and `.spawn` = `<epoch ≥ born> 4` → dispatch, as today; a `.spawn` older
  than born does not count as "never came up";
- pane rungs: a limit banner on the pane (`via=banner`) and an auto-continue / `API Error: 429` footer
  (`via=pane`) over a carried transcript banner → no dispatch — red today; controls: a real assistant row
  after the carried banner → dispatch; born unknown (the D-3100 stubs) → dispatch, and the existing
  D-3100/D-3101 cases stay green; an auth pane (`Invalid API key · Please run /login`) → dispatch;
- the pane rung's dating read is uncached (a stale `tscan` does not decide it);
- strand half and no-target strand: a carried banner writes no `.stranded` — red today; the existing
  strand cases stay green;
- a carried rate-limit banner never writes `$REG/<wrapper>-authdead`;
- purge: `carriednote` and `tdate` are removed with the row;
- round 1, ruling 1: the harm review's three steps (born `BANNER_AT`+7 h, `.spawn` rc 0, no swap after the
  row) stay stranded and are moved when a target frees, on the transcript and banner rungs — red before;
  a missing `lastswap` is a block — red before; a swap in the row's own second is a block, one second
  later is carried in; a torn `lastswap` (empty, words, a `REG[$(…)]` payload, two numbers, `+0`) is a
  block and never evaluated, a leading zero is still base ten; control: a swap after the row is carried in;
- round 1, ruling 2: a second verdict with unchanged keys does not read the transcript again (counted) —
  red before; a grown transcript with its mtime held still, a same-size file with a new mtime, a new born
  and another transcript path each read again; rc 2 is never cached; a record for another key or a torn
  one is never trusted.

## Deviations found

- **D-3526** — *The continuity spec's C12 rule ("a banner older than the session's landing is not a
  block") ships on D-3522's carrier, the pane's tmux `#{session_created}`, joined by the registry's
  existing `$REG/<id>.lastswap`, instead of a new `$REG/<id>.landed`; and a landing whose TUI never came
  up is still rescued.* Operator ruling 2026-09-28. Measured on 259 rescues since 2026-09-08, the two
  carriers suppress the same 26 carried-in rescues and none of the 194 fresh ones; `_pane_born` is already
  shipped and source-pinned, needs no write in `cmd_swap`, no new field for the clock (the new registry
  fields, `carriednote` and `tdate`, are only the telemetry floor and the read cache) and no bootstrap for
  sessions that landed before the deploy, and gives the 401 and rate-limit arms one clock. A row is
  carried in only when it predates the pane's birth AND `lastswap` is strictly later than it (round 1,
  ruling 1). The clock alone differed from `.landed` on a same-account restart (an OOM kill, a supervisor
  revival, `ccd stop`/`start`, `ws-restore`, a refused carry's restart): a pre-restart row stopped
  counting, so a restart more than 6 h after a real block — which Claude Code does not re-drive —
  retracted the strand, and the session was never moved when a target freed (the round-1 harm review
  measured it in a fixture; 5 of the 24 strands in `swap.log` since 2026-09-11 outlasted 6 h). With
  `lastswap`, a same-account restart keeps its own account's row as a block, as `.landed` would: the
  strand stays and the session moves when a target frees. What still differs from `.landed`: `lastswap`
  is stamped at the rescue or affinity DISPATCH as well as at the landing, so a dispatch that neither
  landed nor reached `_swap_refuse` (an early `die` in `cmd_swap`, a failed `systemd-run`) leaves a stamp
  later than the row, and a same-account restart after it reads a pre-dispatch row as carried in. Pane
  positives are dated by the transcript's NEWEST REAL row (rc 3 only when that row is the carried
  rate-limit banner), not the spec's newest rate-limit row, so a pane block is never suppressed once this
  process has written anything; the pane rungs' dated read is cached in `tdate` on the pane's birth and
  the transcript's path, mtime and size (round 1, ruling 2), so it costs one read per process and file,
  not one per 5 s tick. Every condition the code cannot measure — born, the row's timestamp, the
  transcript, `lastswap` — keeps the verdict: an unanswered `_pane_born` never takes a positive away. The
  ruling's second half: 24 of the 26 carried-in rescues were landings whose Claude Code never came up
  (spawn rc 4), and the false rescue was what moved them off a non-starting account; a carried-in row
  therefore stays a block when this process's `.spawn` records rc 4 at or after its birth. SUPERSEDES the
  session-continuity wave-2 plan's Tasks 1–2 (`.landed`, the `newest` reader mode,
  `_limit_dated_verdict`), which were written before D-3522 and target lines that no longer exist; `main`
  records that supersession in that plan's status block and the programme ledger (#200). That plan's
  D-3497 stays that rule's number, defined there, and its Tasks 3–5 (stage 4's rules 2–3) are re-planned
  to read the dated verdict from this reader. CARRIED: the 30 s `tscan` cache is not keyed on the
  process, so a positive cached by the previous process can outlive a same-account restart by up to 30 s
  (as D-3522's 401 arm already does).
