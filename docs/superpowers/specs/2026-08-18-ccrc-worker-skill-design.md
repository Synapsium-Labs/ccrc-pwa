# The worker protocol becomes a mechanism — a `ccrc-worker` skill, shipped and pinned

**Status:** APPROVED by the owner 2026-08-18 ("let's add"), queued on the programme after Stage 2d
(installer) and Stage 2e (`CCRC_REMOTE_CONTROL`). This is a decision record with the design shape;
the executing slice gets its own plan via writing-plans when its turn comes.

## The problem, measured

A spawned program workspace leverages ccrc on two different terms:

- **Substrate is ambient** — supervisor unit, auto-swap/auto-compact, session hooks → hookstate →
  idle-gated mail, statusline telemetry, the workspace hold, the mail lane. A worker benefits
  without knowing any of it exists. Nothing to fix here.
- **Protocol is prose** — everything the worker must actively DO is re-typed into each wave's brief
  by the coordinator. The coordinator skill itself says so: *"The brief must tell the worker to
  commit on its workspace branch"* (`ccd/coordinator-skill/SKILL.md:182`). Evidence this fails:
  - **F5 (Build 4, live):** a worker sat on `feat/build4-w1-items` while the done-fingerprint
    measured the workspace branch — branch discipline was only prose, and the failure surfaced
    late, at wave close (`stale-tip`), not at the moment of the mistake.
  - **F7 (Build 4, live):** a ~3KB multi-line brief is fragile to type over tmux (echo-verify
    flake + self-blocking draft). Every byte of standing protocol carried per-brief makes the
    fragile payload bigger.
  - The wave-2 worker invoked executing-plans/TDD and built its task list **because the brief said
    so** — coordinator diligence, not mechanism.

In house terms: the worker protocol is a request; this slice makes it a mechanism.

## Design

1. **`ccd/worker-skill/SKILL.md`** — sibling of `ccd/coordinator-skill/`, the standing worker
   protocol as numbered clauses. Draft clause set (finalized at plan time):
   - Commit on THIS workspace's branch, never a new feature branch (the done-fingerprint
     re-measures the workspace branch tip; a feature branch wedges every close `stale-tip`).
   - Ack your brief's delivery id; reply to the coordinator through mail (`toId:'coordinator'`),
     never by typing into your own pane for someone else to scrape.
   - Operator questions ride ask envelopes (structured ask), not free text.
   - Your requirements are the brief + the plan file it names, including its deviation ledger;
     the plan's text governs over your recollection of the spec.
   - Invoke the named execution skill (executing-plans or subagent-driven-development) rather than
     improvising a workflow; TDD discipline binds.
   - Large payloads arrive as files + a "read <path>" nudge (F7); never ask the coordinator to
     paste content into your pane.
   - Never run destructive ccd verbs (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`,
     `ws-restore`) — your workspace's lifecycle belongs to ccd and the human.
   - A done-claim names the handoff commit ON the workspace branch and is sent via mail; the
     coordinator re-measures — do not re-assert a rejected claim without new commits.
2. **Shipping:** `ccd/install-worker-skill.sh` mirroring `install-coordinator-skill.sh`
   (byte-for-byte copy into `~/.cc-sessions/worker-skill/`, converge-on-inode), installed by
   deploy's agent lane and by `ccrc install` (Stage 2d's `_inst_files`/`_inst_hooks` shape).
3. **Pinning:** `server/test/worker-skill.test.ts` pins the clauses VERBATIM, exactly as
   `coordinator-skill.test.ts` pins the coordinator's nine — a softened clause is a red suite.
   Destructive-verb names may appear only inside the forbidding clause (same counting rule).
4. **Mechanical loading:** `POST /api/runs/:id/dispatch` — already the one writer of the worker's
   kickoff sequence (`/clear` etc.) — injects the skill invocation line into the kickoff, so the
   protocol loads without depending on the coordinator's brief-writing. The brief shrinks to:
   plan path + task range + wave-specific interfaces.
5. **Coordinator-side trim:** the coordinator skill's dispatch template drops the re-typed
   protocol paragraphs in favor of "the worker skill governs; the brief carries only wave
   specifics" — its own pinned clauses updated in the same change.

## Boundaries

- No `ccd/ccd` edits. No new ccd verbs, no exec-whitelist changes, no `FLEET_PROTO` bump — the
  dispatch injection is server-side text in an existing route.
- Additive wire only; an older worker that never loads the skill still works exactly as today
  (briefs remain self-sufficient until the coordinator-side trim lands, which is the LAST step).

## Open at plan time

- Exact clause wording (walk the Build 4/7/8 findings for anything else that was learned the hard
  way and belongs in a clause).
- Whether the dispatch injection names the skill by path (`~/.cc-sessions/worker-skill/SKILL.md`)
  or by a registered skill name, depending on how the fleet's Claude sessions discover skills.
- Whether `ccrc doctor`'s remedy surface should mention the worker skill anywhere (likely no —
  it is session protocol, not box health).
