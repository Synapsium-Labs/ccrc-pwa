# Work kept inside Claude Code's transcript folders: a doctor line, a fleet-health count and a skill rule (task note)

One task, a follow-up to the fleet disk retention spec (`docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md`,
§10, "work inside transcript dirs"). It measures and warns only: nothing here deletes, moves or writes anything under a
config dir, and the transcript retention policy itself stays out of scope (it needs its own design and ruling first).

## Deviations found

- **D-7898 (2026-11-03)** — Work kept inside Claude Code's transcript folders: a doctor check, a fleet-health count and
  a skill rule. Sessions sometimes write scratch repositories, reports and build output under a config dir's
  `projects/<slug>/` instead of a workspace or their temp root; nothing governs those bytes, the swap carry copies them,
  and a transcript retention would delete them with no rescue.
  - **The shapes Claude Code writes** (`TRANSCRIPT_SHAPES`, `shared/disk.ts`; doctor's twin `_DR_TW_SHAPES`), measured
    read-only on a fleet box on 2026-11-03 across every config dir (Step 0, below): at the slug level a transcript
    `<uuid>.jsonl` (a file), a session directory `<uuid>/` and `memory` (a directory, or ccrc's link to a shared one);
    inside a session directory `subagents/`, `tool-results/` and `workflows/`. `<uuid>` is the lowercase 8-4-4-4-12 hex
    form. Everything else at either level is counted, and so is anything directly under `projects/` that is not a
    directory. The session level is in because that is where the measured work sat; the spec's text named the slug
    level only.
  - **Size** is what `du -sb` gives: the apparent bytes of every file and link under the entry, each inode once, a
    directory itself 0 (measured: GNU du 9.7 charges a directory 0 in byte totals). A link is never followed.
  - **Doctor** (`ccd/ccrc-doctor-checks`, `_check_transcript_work`, on the `transcripts` line of the table): for each
    roster config dir (`~/.ccrc/accounts.sh`, `_check_disk`'s read), the count, the bytes and the five largest entries
    as `<account>/<slug>/<entry> <size>`. WARN when the counted entries hold more than 1 GiB in all or any one more than
    256 MiB; PASS otherwise, naming the largest. Bounded at 20 s (`CCRC_DOCTOR_TRANSCRIPT_WORK_TIMEOUT`); each `du` gets
    what is left. A walk out of time, a directory it cannot list, a size it cannot read and an unreadable roster
    projection each WARN that the work is unmeasured, never a PASS. SKIP on a `server`-role box.
  - **Fleet health**: the agent's `disk` op carries the latest walk (`transcriptWork`, `agent/src/transcriptWork.ts`),
    with the same shapes, sizing and bound, its roots resolved from the roster on the box (no path crosses the link).
    The walk runs in the background at most every 10 minutes (`TRANSCRIPT_WORK_REFRESH_MS`) and the op never waits for
    it, because the op's request deadline (15 s) is below the walk's bound; the first reply after an agent starts
    carries none. A walk that failed anywhere or ran out of time is unmeasured as a whole. The server's decider
    (`transcriptWorkBlock`, `server/src/disk.ts`) gives it a level by the same two bounds, and the disk alarm lane
    passes it through to `GET /api/fleet/health` as `disk.transcriptWork` (`{at, level, entries, bytes, top}`); a reply
    without one, and a read that failed, keep the one held. It never moves the disk level.
  - **The PWA** shows the count in Settings › Automation › Work in transcript folders, a quiet card after Backups:
    "N entries kept in transcript folders · size", amber when over a bound or unmeasured, and the largest entries. There
    is no Settings › Disk view on main; the disk banner is unchanged (it is about free space).
  - **The skills**: clause 18 of the coordinator and worker skills adds that work, scratch repositories, reports and
    build output never go under a Claude config dir's `projects/` transcript folders; they belong in the workspace or
    the session's temp root.
  - **Not changed**: any collector or retention behaviour, the transcript files, and the history programme's sweep
    (`ccd/history/*`), which owns transcript reading.

## Step 0, measured

Read-only, every config dir on a fleet box (`find <cfg>/projects -mindepth 2 -maxdepth 3`, uuids folded):

| Level | Entry | Count |
|---|---|---|
| slug | `<uuid>.jsonl` (file) | 2274 |
| slug | `<uuid>/` (dir) | 2122 |
| slug | `memory` (link) | 187 |
| slug | `memory/` (dir) | 119 |
| slug | `memory.pre-ccrc-<stamp>/` (dir, a migration's leftover) | 5 |
| slug | a stray file | 1 |
| session | `tool-results/` | 1969 |
| session | `subagents/` | 823 |
| session | `workflows/` | 549 |
| session | other directories a session made (recovery, baselines, a scratchpad) | 24 |

The largest counted entry was 32 MiB, so today's box PASSes under the two bounds.

## Widths

The card was judged in real Chrome over the production build (`pwa/browser/transcript-work-card.browser.test.ts`), in
Refined and Instrument, dark and light, with a long slug the card must wrap:

| Width | Over a bound (5 entries named; both themes) | None kept (dark) | Unmeasured (dark) |
|---|---|---|---|
| 360 | fits; each long name wraps inside the card | fits | fits |
| 390 | fits; each long name wraps inside the card | fits | fits |
| 1280 | fits; the longest names wrap inside the card | fits | fits |
| 1920 | fits; the longest name wraps inside the card | fits | fits |

Nothing scrolls sideways at any width: not the card, the detail pane or the page.
