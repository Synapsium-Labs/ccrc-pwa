# Disk lane stall alert and the pending-entry roll: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a cleanup lane that stops finishing anything while the disk is under pressure tells the operator once, and the
most common cause found so far (one session whose entry identity stayed pending) heals itself with no one acting.

**Why (measured on a fleet box, 2026-11-23):** the systemd user manager restarted and took the tmux server with it. The
first respawn found no tmux server and took `_tmux_new_session`'s slow path, `systemd-run --user --scope … tmux
new-session … '<cmd>'`. systemd expands `${VAR}` in command arguments by default, so the pane writer that
`_plat_workdirid_pane` composes lost `${p%?.}` and wrote nothing; the `v1 pending` line `_spawn_workdirid_pending` wrote
before the spawn was never replaced, and the pane still started claude. `_ws_reclaim_workdir_shared` reads every row's
entry field for every child, and one pending row answers unmeasured, so every child reclaim on the box was refused for
about 13 hours (several hundred failed audits), about 150 closed child workspaces piled up, and the disk reached 98%.
Nothing alerted. A stop and start of that one idle session (ccd's own remedy text) cleared it within a minute.

**Architecture:**

- C6 (Attention and Notification) owns the alert. `server/src/diskLaneStall.ts` (L1) folds the last 24 hours of the
  three cleanup acts' journal rows (`reclaim`, `collect`, `shed-deps` in `lifecycle_events`) into each lane's progress:
  subjects whose latest row says work stands blocked wait (each lane asks its owner: the reclaim's failure line, the
  collector's and the shed's refusal tables), while the last registry listing still names a registry subject; a lane
  with waits is stuck when nothing of its own was `done` for an hour and its oldest wait has stood an hour. A stuck lane
  while `DiskHealth.pressure` stands is stalled. The
  reason is the holding row's word from the coord frame's `cleanupHeldBy` items (the one owner of held-by words and
  sentences), else ccd's most common token, else `unknown`. It composes one Waiting on you item and one push.
- `server/src/diskLaneStallLane.ts` (L4) reads the facts and acts on those answers: it settles, raises and pushes
  through `notify` (the push outbox's path). Its row is `diskLaneStall` (every five minutes, one pass at a time),
  dispatched beside the disk alarm above the registry read's fail-shut return.
- The journal read is `coord/lifecycleLaneRows.ts`, `store.ts`'s body moved out (`reviewCapStore.ts`'s idiom), one
  statement `INDEXED BY lifecycle_by_at`, newest 20,000 rows at most, returned oldest first.
- The item carries a new action, `{ verb: 'disk-lane-stall', lane, reason }` (`shared/ledgers.ts`), so one open item per
  lane and reason is the key, as `untrusted-build` keys on its build. It takes no act; ccrc settles it.
- C4 owns the self-heal. `entryPendingEpisodesOf` (`cleanupHeldBy.ts`, L1) keeps each row's `entry-pending` episode
  (first named, and the latest pass after which a new read named it); the roll lane keeps it in its memory and
  `autoRollVerdict` (`coord/rollTarget.ts`, L1) treats a row named pending for 10 minutes, whose running process was
  already running when it was first named, and which a read past the spawn's first two minutes named, as behind.

**Tech stack:** TypeScript, `node:sqlite`, vitest; `server/` and `shared/` only. No route, no ccd change, no migration.

## Tasks

- [x] Red: `server/test/roll-target.test.ts` (the pending reason in the verdict) and `server/test/roll-lane.test.ts`
  (the pass keeps the episode, rolls once, and forgets a row no read names).
- [x] Green: `ENTRY_PENDING_ROLL_MS`, `entryPendingStuck`, `AutoRollInput.entryPendingSince`,
  `RollSweepMemory.pendingSince`, `RollSweepDeps.heldBy`; `watch.ts` passes the last coord frame's `cleanupHeldBy`.
- [x] `server/test/disk-lane-stall.test.ts`: the decider's table, the item's words, the action's reader, the statement's
  plan, the lane raising once and settling on the next done, and a restart re-sending nothing.
- [x] The lane, its row, its wiring, the store read and its port member; the context table's two C6 rows.
- [x] Review round 1, red first: benign refusals and vanished subjects are no wait; no frame and no listing are
  unmeasured, never none; a holder not seen since start is no change of cause; the roll needs a fresh read; the item's
  self-heal words are conditional; a server restart can roll a still-pending session once more, pinned.

## Deviations found

- **D-8955 (2026-11-23)** — disk-lane-stall-and-pending-roll. A disk cleanup lane (child reclaim, temp-root collect,
  dependency shed) that has waits and no `done` for an hour while the disk is under pressure raises one Waiting on you
  item and one push, keyed on lane and reason, settled by ccrc when the lane finishes one again; and an idle session
  whose entry identity the cleanup lanes have named pending for 10 minutes is rolled, at most once per pending episode.
  Recorded departures from the brief, by slug:
  - `space-is-counted`: "how much space is waiting" is the count of waiting subjects and the critical filesystem's used
    percent and free bytes. No server reader measures a closed child's or a temp root's bytes, so none is invented.
  - `pressure-is-critical`: pressure is the disk block's `pressure`, a critical filesystem (92%), the one definition
    `diskBlockOf` holds; a warn-level disk raises nothing. Pressure gates the raise only, never the settle.
  - `pending-from-held-by`: the pending state is read through the held-by items only (the existing reader). The server
    keeps no second reader of ccd's `workdirid` grammar, so "pending for 10 minutes" is the time since the cleanup lanes
    first named the row, in this process. A server restart starts each episode again, so a session still pending after
    its roll can be rolled once more after each restart (corrected in review round 1: it does not only delay a roll).
  - `roll-needs-a-fresh-read`: an item is each held child's latest audit, and a spawn writes `pending` before its pane
    exists, so an audit in those seconds names a healthy row until that child is asked again. The roll counts a naming
    only when it appeared after a pass taken two minutes or more after the process started (newly named, or the row
    holding more than it did). A pending row that holds one child and is first seen inside that window waits for the
    alert instead.
  - `waits-by-owner`: a row waits only when its lane's owner says work stands blocked: the child reclaim's
    `childReclaimFailureLine`, the collector's pacing and refusal words (`collectRefusalBlocks`), and the shed's new
    total refusal table in `depsShed.ts` (`DEPS_SHED_REFUSAL_CLASS_TABLE`, from which `DEPS_SHED_FINAL_REFUSALS` is now
    derived; a test holds its keys equal to ccd's `_ws_shed_refused` words). A registry subject the last listing does
    not name is no wait; a temp root is not a registry row.
  - `unmeasured-is-not-none`: before the first coord frame (no held-by facts) or the first registry listing, a lane that
    reads them answers unknown and moves nothing. A holder word this process has not seen since it started is not a
    change of cause, because the held-by facts are re-read one audit at a time after a restart.
  - `reclaim-fold-is-lane-level`: legitimately different from the child reclaim's attention list, which folds the same
    journal per child inside the reclaim sweep, below the registry read's fail-shut return. This lane runs above that
    return and asks a lane-level question (the oldest wait and the last done across every child); it reuses the owner's
    failure line and the owner's words for the token (`childReclaimFailingWord`).
  - `self-heal-is-conditional`: the item says the automatic roll may restart the session, unless the roll is kept from
    it; it promises nothing the roll's gates can refuse.
  - `roll-keeps-its-gates`: the pending reason passes every roll gate (the setting, `.no-roll`, the Overlord, the
    90-minute quiet window, compaction, hibernation due); a box with no install record rolls nothing, as before.
  - `fix-the-expansion-later`: the slow path's `${VAR}` expansion under `systemd-run` is not changed here (it is ccd's,
    and a quoting change on the spawn line needs its own red test on Linux); this change makes the wedge loud and short.
